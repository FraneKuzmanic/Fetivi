import {
  QUEUE_OPTIONS,
  QUEUES,
  runTranslation,
  type TranslationDeps,
  type TranslationJobData,
  type TranslationModel,
} from '@fetivi/domain';
import type { JobDefinition } from '../runner';

/** Translates one block revision into the seven guest languages. */
export function translateBlockJob(
  deps: TranslationDeps & { model: TranslationModel },
): JobDefinition<TranslationJobData> {
  return {
    name: QUEUES.translateBlock,
    queue: QUEUE_OPTIONS.translateBlock,
    async handler({ blockId, revision }) {
      const result = await runTranslation(deps, { blockId, revision });
      // Never the block text.
      console.log(JSON.stringify({ job: QUEUES.translateBlock, blockId, revision, result }));
    },
  };
}
