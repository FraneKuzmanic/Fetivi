import { QUEUE_OPTIONS, QUEUES, refreshRecordTask } from '@fetivi/domain';
import type { JobDefinition } from '../runner';
import { type DraftingJobDeps, draftingDeps, logTask } from './draft-place';

/**
 * Re-drafts one verified place for the pre-season refresh and queues a refresh diff when its
 * facts changed. Never retried, like drafting.
 */
export function refreshCatalogJob(deps: DraftingJobDeps): JobDefinition<{ taskId: string }> {
  return {
    name: QUEUES.refreshCatalog,
    queue: QUEUE_OPTIONS.refreshCatalog,
    async handler({ taskId }) {
      const summary = await refreshRecordTask(draftingDeps(deps), taskId, deps.now());
      logTask(QUEUES.refreshCatalog, taskId, summary);
    },
  };
}
