import {
  type Db,
  type DraftingModel,
  type DraftingTaskSummary,
  draftCandidateTask,
  QUEUE_OPTIONS,
  QUEUES,
} from '@fetivi/domain';
import type { Egress } from '@fetivi/egress';
import type { JobDefinition } from '../runner';

export interface DraftingJobDeps {
  db: Db;
  draftingModel: DraftingModel;
  /** A fresh egress per task, allowing only that task's own source hosts (ADR 0020). */
  fetchFor: (allowlist: readonly string[]) => Egress['fetch'];
  /** The process egress: the model API and commons.wikimedia.org. */
  fetch: Egress['fetch'];
  userAgent: string;
  now: () => Date;
}

export const draftingDeps = (deps: DraftingJobDeps) => ({
  db: deps.db,
  model: deps.draftingModel,
  fetchFor: deps.fetchFor,
  commonsFetch: deps.fetch,
  userAgent: deps.userAgent,
});

/** The job's one log line: ids and counts only, never a URL, page text or model output. */
export const logTask = (job: string, taskId: string, summary: DraftingTaskSummary) =>
  console.log(JSON.stringify({ job, taskId, ...summary }));

/**
 * Drafts one ticked Seeding candidate's draft item. Never retried (`retryLimit: 0`): a failure
 * is a code on the task, and "Draft waiting" tries again.
 */
export function draftPlaceJob(deps: DraftingJobDeps): JobDefinition<{ taskId: string }> {
  return {
    name: QUEUES.draftPlace,
    queue: QUEUE_OPTIONS.draftPlace,
    async handler({ taskId }) {
      const summary = await draftCandidateTask(draftingDeps(deps), taskId, deps.now());
      logTask(QUEUES.draftPlace, taskId, summary);
    },
  };
}
