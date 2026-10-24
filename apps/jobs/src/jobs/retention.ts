import { type Db, QUEUE_OPTIONS, QUEUES, RETENTION_CRON, runRetention } from '@fetivi/domain';
import type { JobDefinition } from '../runner';

export interface RetentionDeps {
  db: Db;
  now: () => Date;
}

/**
 * Daily 02:30 UTC: deletes every Space whose 30-day read-only period has ended, keeping an
 * Order ledger row per Order (and the conversation if the guest opted in), and purges ledger rows
 * past their 11 years. A held Space is tried again the next day.
 */
export function retentionJob(deps: RetentionDeps): JobDefinition {
  return {
    name: QUEUES.retention,
    queue: QUEUE_OPTIONS.retention,
    cron: RETENTION_CRON,
    async handler() {
      const counts = await runRetention(deps.db, deps.now());
      // Counts only: no ids, emails or message text.
      console.log(JSON.stringify({ job: QUEUES.retention, ...counts }));
    },
  };
}
