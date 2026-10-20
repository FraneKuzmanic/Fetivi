import {
  type CatalogTranslationJobData,
  QUEUE_OPTIONS,
  QUEUES,
  runCatalogTranslation,
  type TranslationJobDeps,
} from '@fetivi/domain';
import type { JobDefinition } from '../runner';

/** Translates one catalog record revision into the seven guest languages. */
export function translateCatalogRecordJob(
  deps: TranslationJobDeps,
): JobDefinition<CatalogTranslationJobData> {
  return {
    name: QUEUES.translateCatalogRecord,
    queue: QUEUE_OPTIONS.translateCatalogRecord,
    async handler({ recordId, revision }) {
      const result = await runCatalogTranslation(deps, { recordId, revision });
      // Never the record text.
      console.log(
        JSON.stringify({ job: QUEUES.translateCatalogRecord, recordId, revision, result }),
      );
    },
  };
}
