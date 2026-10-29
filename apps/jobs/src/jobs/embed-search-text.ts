import {
  type CatalogEmbeddingJobData,
  type EmbeddingDeps,
  type HostPlaceEmbeddingJobData,
  QUEUE_OPTIONS,
  QUEUES,
  runCatalogEmbedding,
  runHostPlaceEmbedding,
} from '@fetivi/domain';
import type { JobDefinition } from '../runner';

/** Embeds a catalog record's newly published translations for search (61). */
export function embedCatalogRecordJob(deps: EmbeddingDeps): JobDefinition<CatalogEmbeddingJobData> {
  return {
    name: QUEUES.embedCatalogRecord,
    queue: QUEUE_OPTIONS.embedCatalogRecord,
    async handler({ recordId, revision }) {
      const { result, tokens } = await runCatalogEmbedding(deps, { recordId, revision });
      // Never the text.
      console.log(
        JSON.stringify({ job: QUEUES.embedCatalogRecord, recordId, revision, result, tokens }),
      );
    },
  };
}

/** Embeds a host-added place's newly published name and note for search (61). */
export function embedHostPlaceJob(deps: EmbeddingDeps): JobDefinition<HostPlaceEmbeddingJobData> {
  return {
    name: QUEUES.embedHostPlace,
    queue: QUEUE_OPTIONS.embedHostPlace,
    async handler({ hostPlaceId, revision }) {
      const { result, tokens } = await runHostPlaceEmbedding(deps, { hostPlaceId, revision });
      // Never the host's text.
      console.log(
        JSON.stringify({ job: QUEUES.embedHostPlace, hostPlaceId, revision, result, tokens }),
      );
    },
  };
}
