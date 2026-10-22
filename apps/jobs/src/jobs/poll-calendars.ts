import {
  CALENDAR_POLL_MINUTES,
  type CalendarDeps,
  liveFeedIds,
  pollFeed,
  QUEUE_OPTIONS,
  QUEUES,
  type StayNotifyDeps,
  type StayNotifyJobData,
  sendStayDatesChanged,
  uuidFrom,
} from '@fetivi/domain';
import type { JobDefinition } from '../runner';

export type CalendarJobDeps = CalendarDeps & StayNotifyDeps;

/**
 * Every 30 minutes: one poll-calendar job per feed of a live unit. The job id is keyed by feed and
 * 30-minute slot, so an overlapping or repeated run adds nothing.
 */
export function pollCalendarsJob(deps: Pick<CalendarDeps, 'db' | 'queue' | 'now'>): JobDefinition {
  return {
    name: QUEUES.pollCalendars,
    queue: QUEUE_OPTIONS.pollCalendars,
    cron: `*/${CALENDAR_POLL_MINUTES} * * * *`,
    async handler() {
      const feeds = await liveFeedIds(deps.db);
      const slot = Math.floor(deps.now().getTime() / (CALENDAR_POLL_MINUTES * 60_000));
      for (const feedId of feeds) {
        await deps.queue.send(QUEUES.pollCalendar, { feedId }, deps.db, {
          id: uuidFrom(`calendar:${feedId}:${slot}`),
        });
      }
      console.log(JSON.stringify({ job: QUEUES.pollCalendars, feeds: feeds.length }));
    },
  };
}

/** Reads one feed. Ids and counts only in the log: the URL holds the export secret. */
export function pollCalendarJob(deps: CalendarDeps): JobDefinition<{ feedId: string }> {
  return {
    name: QUEUES.pollCalendar,
    queue: QUEUE_OPTIONS.pollCalendar,
    async handler({ feedId }) {
      const result = await pollFeed(deps, feedId);
      console.log(JSON.stringify({ job: QUEUES.pollCalendar, feedId, ...result }));
    },
  };
}

/** Emails the host when a calendar moved a Stay. */
export function stayNotifyJob(deps: StayNotifyDeps): JobDefinition<StayNotifyJobData> {
  return {
    name: QUEUES.stayNotify,
    queue: QUEUE_OPTIONS.stayNotify,
    async handler(job) {
      const outcome = await sendStayDatesChanged(deps, job);
      console.log(
        JSON.stringify({ job: QUEUES.stayNotify, stayId: job.stayId, kind: job.kind, outcome }),
      );
    },
  };
}
