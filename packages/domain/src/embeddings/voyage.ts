import type { Egress } from '@fetivi/egress';
import { z } from 'zod';
import { EMBEDDING_LIMITS, EMBEDDING_MODEL, VOYAGE_ENDPOINT } from './vocabulary';

// Voyage AI embeddings. Neither the key nor the texts (guest search words, catalog text) are ever
// logged or put in an error message: errors carry the status code at most.

/** A search wish ('query') or a stored text ('document'); Voyage embeds them slightly differently. */
export type EmbeddingInput = 'query' | 'document';

export interface Embedder {
  /** The model id stored next to every vector. */
  readonly model: string;
  /** One vector per text, in order. Throws `EmbeddingUnavailableError` when it cannot answer. */
  embed(texts: string[], input: EmbeddingInput): Promise<{ vectors: number[][]; tokens: number }>;
}

export class EmbeddingUnavailableError extends Error {
  override name = 'EmbeddingUnavailableError';
}

/** No key configured: unavailable on every call, so jobs stop quietly instead of retrying. */
export class EmbeddingNotConfiguredError extends EmbeddingUnavailableError {
  override name = 'EmbeddingNotConfiguredError';
  constructor() {
    super('no key');
  }
}

const voyageResponse = z.object({
  data: z.array(z.object({ embedding: z.array(z.number()), index: z.number().int() })),
  usage: z.object({ total_tokens: z.number() }),
});

/** The vectors of a Voyage response in input order; anything else than `count` vectors is unavailable. */
export function parseVoyageResponse(
  json: unknown,
  count: number,
): { vectors: number[][]; tokens: number } {
  const parsed = voyageResponse.safeParse(json);
  if (!parsed.success) throw new EmbeddingUnavailableError('unexpected response');
  const data = [...parsed.data.data].sort((a, b) => a.index - b.index);
  if (data.length !== count) throw new EmbeddingUnavailableError('unexpected response');
  return { vectors: data.map((d) => d.embedding), tokens: parsed.data.usage.total_tokens };
}

export interface VoyageEmbedderOptions {
  fetch: Egress['fetch'];
  /** Optional in config: without it every embedding is unavailable. */
  apiKey: string | undefined;
  model?: string;
}

export function createVoyageEmbedder(options: VoyageEmbedderOptions): Embedder {
  const model = options.model ?? EMBEDDING_MODEL;
  return {
    model,
    async embed(texts, input) {
      if (!options.apiKey) throw new EmbeddingNotConfiguredError();
      if (texts.length === 0) return { vectors: [], tokens: 0 };
      let response: Response;
      try {
        response = await options.fetch(VOYAGE_ENDPOINT, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ input: texts, model, input_type: input, truncation: true }),
          signal: AbortSignal.timeout(
            input === 'query'
              ? EMBEDDING_LIMITS.queryTimeoutMs
              : EMBEDDING_LIMITS.documentTimeoutMs,
          ),
        });
      } catch {
        throw new EmbeddingUnavailableError('request failed');
      }
      if (!response.ok) throw new EmbeddingUnavailableError(`status ${response.status}`);
      let json: unknown;
      try {
        json = await response.json();
      } catch {
        throw new EmbeddingUnavailableError('invalid json');
      }
      return parseVoyageResponse(json, texts.length);
    },
  };
}
