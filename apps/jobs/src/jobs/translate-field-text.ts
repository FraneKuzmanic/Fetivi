import {
  type FieldTextTranslationJobData,
  QUEUE_OPTIONS,
  QUEUES,
  runFieldTextTranslation,
  type TranslationJobDeps,
} from '@fetivi/domain';
import type { JobDefinition } from '../runner';

/** Translates one revision of a host's free-text field (access, parking, house-rule or amenity note). */
export function translateFieldTextJob(
  deps: TranslationJobDeps,
): JobDefinition<FieldTextTranslationJobData> {
  return {
    name: QUEUES.translateFieldText,
    queue: QUEUE_OPTIONS.translateFieldText,
    async handler({ fieldTextId, revision }) {
      const result = await runFieldTextTranslation(deps, { fieldTextId, revision });
      // Never the host's text.
      console.log(
        JSON.stringify({ job: QUEUES.translateFieldText, fieldTextId, revision, result }),
      );
    },
  };
}
