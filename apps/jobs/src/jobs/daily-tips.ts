import {
  DAILY_TIPS_CRON,
  type Db,
  dueTipSpaces,
  enqueueGuestNotification,
  gatherTipInput,
  type JobQueue,
  pickDailyTip,
  QUEUE_OPTIONS,
  QUEUES,
  type TipRule,
  type WeatherSource,
} from '@fetivi/domain';
import type { JobDefinition } from '../runner';

export interface DailyTipsDeps {
  db: Db;
  queue: JobQueue;
  now: () => Date;
  weather: Pick<WeatherSource, 'report'>;
}

/**
 * Every 15 minutes: one guest-notify job per space due a tip (17:00–21:00 property time). The key
 * `space:<id>:daily_tip:<send date>` is the job id and the ledger key, so repeated runs and retries
 * add nothing, even when the facts changed in between. One space failing never stops the rest.
 */
export function dailyTipsJob(deps: DailyTipsDeps): JobDefinition {
  return {
    name: QUEUES.dailyTips,
    queue: QUEUE_OPTIONS.dailyTips,
    cron: DAILY_TIPS_CRON,
    async handler() {
      const now = deps.now();
      const due = await dueTipSpaces(deps.db, now);
      if (due.length === 0) {
        console.log(JSON.stringify({ job: QUEUES.dailyTips, due: 0 }));
        return;
      }

      const picked: Record<TipRule, number> = { rain: 0, event: 0, gap: 0 };
      let none = 0;
      let failed = 0;
      let weather: 'ok' | 'unavailable' = 'ok';
      for (const space of due) {
        try {
          const input = await gatherTipInput(deps.db, deps.weather, space, now);
          if (input.weather === 'unavailable') weather = 'unavailable';
          const tip = pickDailyTip(input);
          if (!tip) {
            none++;
            continue;
          }
          await enqueueGuestNotification(deps.db, deps.queue, {
            kind: 'daily_tip',
            spaceId: space.spaceId,
            sendDate: space.sendDate,
            tip,
          });
          picked[tip.rule]++;
        } catch (error) {
          console.error(`daily-tips: space ${space.spaceId} failed`, error);
          failed++;
        }
      }
      // Ids and counts only, never tip text or contact data.
      console.log(
        JSON.stringify({
          job: QUEUES.dailyTips,
          due: due.length,
          ...picked,
          none,
          failed,
          weather,
        }),
      );
    },
  };
}
