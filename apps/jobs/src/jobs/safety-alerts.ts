import {
  disruptionAlerts,
  type Executor,
  enqueueGuestNotification,
  type GuestNotifyJobData,
  JADROLINIJA_FEED,
  type JobQueue,
  listAlertSpaces,
  parseJadrolinijaFeed,
  QUEUE_OPTIONS,
  QUEUES,
  SAFETY_ALERTS_CRON,
  type WeatherSource,
  warningAlerts,
} from '@fetivi/domain';
import type { Egress } from '@fetivi/egress';
import type { JobDefinition } from '../runner';

export interface SafetyAlertsDeps {
  db: Executor;
  queue: JobQueue;
  now: () => Date;
  weather: Pick<WeatherSource, 'warnings'>;
  fetch: Egress['fetch'];
  /** Off until Jadrolinija gives written permission to poll its feed (PRD §9). */
  jadrolinija: boolean;
  /** Identifies Fetivi to the Jadrolinija feed. */
  userAgent: string;
}

/**
 * Every 10 minutes: one guest-notify job per (DHMZ warning or Jadrolinija notice, open Space it
 * touches). The key is the job id and the ledger key, so repeated runs add nothing (one alert per
 * warning per space). One feed failing never stops the other. Ferryhopper `get_disruptions` is
 * deliberately not a source: spike S3 found no Croatian data in it.
 */
export function safetyAlertsJob(deps: SafetyAlertsDeps): JobDefinition {
  return {
    name: QUEUES.safetyAlerts,
    queue: QUEUE_OPTIONS.safetyAlerts,
    cron: SAFETY_ALERTS_CRON,
    async handler() {
      const now = deps.now();
      const spaces = await listAlertSpaces(deps.db, now);
      if (spaces.length === 0) {
        console.log(JSON.stringify({ job: QUEUES.safetyAlerts, spaces: 0 }));
        return;
      }

      const warningJobs: GuestNotifyJobData[] = [];
      let warnings: 'ok' | 'unavailable' = 'ok';
      try {
        for (const space of spaces) {
          if (!space.place) continue;
          const language = space.language === 'hr' ? 'hr' : 'en';
          const found = await deps.weather.warnings(space.place, language, now);
          // null: no warning area covers the property, so nothing is known there.
          if (found) warningJobs.push(...warningAlerts(found, space, now));
        }
      } catch (error) {
        // A failed feed sends nothing; it never reads as "no warnings".
        console.error('safety-alerts: DHMZ warnings unavailable', error);
        warnings = 'unavailable';
        warningJobs.length = 0;
      }

      const ferryJobs: GuestNotifyJobData[] = [];
      let ferry: 'ok' | 'off' | 'unavailable' = 'off';
      if (deps.jadrolinija) {
        try {
          const response = await deps.fetch(JADROLINIJA_FEED, {
            headers: { 'User-Agent': deps.userAgent },
          });
          if (!response.ok) throw new Error(`Jadrolinija feed answered ${response.status}`);
          const notices = parseJadrolinijaFeed(await response.text());
          for (const notice of notices) ferryJobs.push(...disruptionAlerts(notice, spaces, now));
          ferry = 'ok';
        } catch (error) {
          console.error('safety-alerts: Jadrolinija feed unavailable', error);
          ferry = 'unavailable';
        }
      }

      for (const data of [...warningJobs, ...ferryJobs]) {
        await enqueueGuestNotification(deps.db, deps.queue, data);
      }
      // Ids and counts only, never notice text.
      console.log(
        JSON.stringify({
          job: QUEUES.safetyAlerts,
          spaces: spaces.length,
          warningAlerts: warningJobs.length,
          ferryAlerts: ferryJobs.length,
          warnings,
          ferry,
        }),
      );
    },
  };
}
