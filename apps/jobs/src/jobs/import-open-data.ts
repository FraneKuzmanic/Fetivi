import { type Db, QUEUE_OPTIONS, QUEUES, runImport } from '@fetivi/domain';
import type { Egress } from '@fetivi/egress';
import type { JobDefinition } from '../runner';

export interface ImportOpenDataDeps {
  db: Db;
  fetch: Egress['fetch'];
  /** Identifies Fetivi to Overpass and the other open-data services. */
  userAgent: string;
  now: () => Date;
}

/**
 * One open-data import an admin started: every source through egress, each failing on its own,
 * then one grouping pass. Never retried (`retryLimit: 0`): the admin imports again.
 */
export function importOpenDataJob(deps: ImportOpenDataDeps): JobDefinition<{ importId: string }> {
  return {
    name: QUEUES.importOpenData,
    queue: QUEUE_OPTIONS.importOpenData,
    async handler({ importId }) {
      const summary = await runImport(
        deps.db,
        importId,
        { fetch: deps.fetch, userAgent: deps.userAgent },
        deps.now,
      );
      if (!summary) {
        console.log(JSON.stringify({ job: QUEUES.importOpenData, importId, skipped: true }));
        return;
      }
      // Counts and outcomes only.
      const outcomes = Object.fromEntries(
        Object.entries(summary.sources).map(([source, result]) => [source, result.outcome]),
      );
      console.log(
        JSON.stringify({
          job: QUEUES.importOpenData,
          importId,
          ...outcomes,
          status: summary.status,
          rows: summary.rows,
          candidates: summary.candidates,
        }),
      );
    },
  };
}
