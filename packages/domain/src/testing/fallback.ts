// Test-only web search: a fetch serving the recorded Brave response (`fallback/recorded/`) and an
// always-down search, so no test reaches the network.
import { readFileSync } from 'node:fs';
import type { Egress } from '@fetivi/egress';
import { BRAVE_ENDPOINT, type WebSearch } from '../fallback/brave';
import { WebSearchUnavailableError } from '../fallback/errors';

export interface RecordedBraveFetchOptions {
  /** Replacement body for the Brave endpoint. */
  body?: string;
}

/**
 * Serves the recorded "kayak rental trogir" response for any Brave web search URL, a 404
 * otherwise. `urls` records every request, so a test can assert nothing was sent.
 */
export function recordedBraveFetch(options: RecordedBraveFetchOptions = {}): Egress['fetch'] & {
  readonly urls: string[];
} {
  const urls: string[] = [];
  const fetch = async (input: string | URL) => {
    const url = String(input);
    urls.push(url);
    if (!url.startsWith(`${BRAVE_ENDPOINT}?`)) return new Response('not found', { status: 404 });
    const body =
      options.body ??
      readFileSync(
        new URL('../fallback/recorded/brave-kayak-trogir.json', import.meta.url),
        'utf8',
      );
    return new Response(body, {
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return Object.assign(fetch, { urls });
}

/** A search that is always down. */
export function unavailableWebSearch(): WebSearch {
  return {
    async search() {
      throw new WebSearchUnavailableError('no key');
    },
  };
}
