import {
  type HostPlaceTranslationJobData,
  QUEUE_OPTIONS,
  QUEUES,
  runHostPlaceTranslation,
  type TranslationJobDeps,
} from '@fetivi/domain';
import type { JobDefinition } from '../runner';

/** Translates one host place revision (a host-added place's name, a note) into the seven guest languages. */
export function translateHostPlaceJob(
  deps: TranslationJobDeps,
): JobDefinition<HostPlaceTranslationJobData> {
  return {
    name: QUEUES.translateHostPlace,
    queue: QUEUE_OPTIONS.translateHostPlace,
    async handler({ hostPlaceId, revision }) {
      const result = await runHostPlaceTranslation(deps, { hostPlaceId, revision });
      // Never the host's text.
      console.log(
        JSON.stringify({ job: QUEUES.translateHostPlace, hostPlaceId, revision, result }),
      );
    },
  };
}
