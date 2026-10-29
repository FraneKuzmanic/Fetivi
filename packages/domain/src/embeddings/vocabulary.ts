/** Voyage's multilingual general model; changing it re-embeds through the backfill. */
export const EMBEDDING_MODEL = 'voyage-4';
export const VOYAGE_HOST = 'api.voyageai.com';
export const VOYAGE_ENDPOINT = `https://${VOYAGE_HOST}/v1/embeddings`;

export const EMBEDDING_LIMITS = {
  /** A guest search waits this long, then falls back to word matching. */
  queryTimeoutMs: 2500,
  documentTimeoutMs: 30_000,
  /** Texts per request in the backfill (Voyage allows 1,000). */
  batchSize: 128,
} as const;
