// Test-only web search: a fetch serving the recorded Brave response (`fallback/recorded/`), an
// always-down search and a fixed one, so no test reaches the network.
import { readFileSync } from 'node:fs';
import type { Egress } from '@fetivi/egress';
import { BRAVE_ENDPOINT, type WebSearch } from '../fallback/brave';
import { WebSearchUnavailableError } from '../fallback/errors';
import type { RawWebHit } from '../fallback/results';

export interface RecordedBraveFetchOptions {
  /** Answer this status instead of 200. */
  status?: number;
  /** Replacement body for the Brave endpoint. */
  body?: string;
}

/**
 * Serves the recorded "kayak rental trogir" response for any Brave web search URL, a 404
 * otherwise. `urls` and `headers` record every request, so a test can assert nothing was sent.
 */
export function recordedBraveFetch(options: RecordedBraveFetchOptions = {}): Egress['fetch'] & {
  readonly urls: string[];
  readonly headers: Headers[];
} {
  const urls: string[] = [];
  const headers: Headers[] = [];
  const fetch = async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    urls.push(url);
    headers.push(new Headers(init?.headers));
    if (!url.startsWith(`${BRAVE_ENDPOINT}?`)) return new Response('not found', { status: 404 });
    const body =
      options.body ??
      readFileSync(
        new URL('../fallback/recorded/brave-kayak-trogir.json', import.meta.url),
        'utf8',
      );
    return new Response(body, {
      status: options.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return Object.assign(fetch, { urls, headers });
}

/** A search that is always down. */
export function unavailableWebSearch(): WebSearch {
  return {
    async search() {
      throw new WebSearchUnavailableError('no key');
    },
  };
}

/** A search that always answers `hits`; `queries` records what it was asked. */
export function fixedWebSearch(hits: readonly RawWebHit[]): WebSearch & {
  readonly queries: string[];
} {
  const queries: string[] = [];
  return {
    queries,
    async search(q) {
      queries.push(q);
      return [...hits];
    },
  };
}
