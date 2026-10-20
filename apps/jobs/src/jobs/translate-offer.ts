import {
  type OfferTranslationJobData,
  QUEUE_OPTIONS,
  QUEUES,
  runOfferTranslation,
  type TranslationJobDeps,
} from '@fetivi/domain';
import type { JobDefinition } from '../runner';

/** Translates one Offer revision (title, description, policy text) into the seven guest languages. */
export function translateOfferJob(
  deps: TranslationJobDeps,
): JobDefinition<OfferTranslationJobData> {
  return {
    name: QUEUES.translateOffer,
    queue: QUEUE_OPTIONS.translateOffer,
    async handler({ offerId, revision }) {
      const result = await runOfferTranslation(deps, { offerId, revision });
      // Never the Offer text.
      console.log(JSON.stringify({ job: QUEUES.translateOffer, offerId, revision, result }));
    },
  };
}
