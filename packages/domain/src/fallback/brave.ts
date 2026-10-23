import type { Egress } from '@fetivi/egress';
import { z } from 'zod';
import { WebSearchUnavailableError } from './errors';
import type { RawWebHit } from './results';
import { FALLBACK_LIMITS } from './vocabulary';

// Brave Search API, web results only. Neither the key nor the query is ever logged or put in an
// error message: errors carry the status code at most.

export const BRAVE_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';

export interface WebSearch {
  /** Throws `WebSearchUnavailableError` when the search cannot answer. */
  search(q: string): Promise<RawWebHit[]>;
}

export function braveUrl(q: string): string {
  const params = new URLSearchParams({
    q,
    count: String(FALLBACK_LIMITS.requestCount),
    result_filter: 'web',
    safesearch: 'strict',
    text_decorations: 'false',
    spellcheck: 'false',
  });
  return `${BRAVE_ENDPOINT}?${params}`;
}

const braveResponse = z.object({
  web: z
    .object({
      results: z
        .array(
          z.object({
            title: z.string(),
            url: z.string(),
            description: z.string().optional(),
          }),
        )
        .default([]),
    })
    .optional(),
});

/** Web hits from a Brave response; no `web` section means none. */
export function parseBraveResponse(json: unknown): RawWebHit[] {
  const parsed = braveResponse.safeParse(json);
  if (!parsed.success) throw new WebSearchUnavailableError('unexpected response');
  return (parsed.data.web?.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    description: r.description ?? '',
  }));
}

export interface BraveSearchOptions {
  fetch: Egress['fetch'];
  /** Optional in config: without it every search is unavailable. */
  apiKey: string | undefined;
}

export function createBraveSearch(options: BraveSearchOptions): WebSearch {
  return {
    async search(q) {
      if (!options.apiKey) throw new WebSearchUnavailableError('no key');
      let response: Response;
      try {
        response = await options.fetch(braveUrl(q), {
          headers: { Accept: 'application/json', 'X-Subscription-Token': options.apiKey },
          signal: AbortSignal.timeout(FALLBACK_LIMITS.timeoutMs),
        });
      } catch {
        throw new WebSearchUnavailableError('request failed');
      }
      if (!response.ok) throw new WebSearchUnavailableError(`status ${response.status}`);
      let json: unknown;
      try {
        json = await response.json();
      } catch {
        throw new WebSearchUnavailableError('invalid json');
      }
      return parseBraveResponse(json);
    },
  };
}
