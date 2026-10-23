import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BRAVE_ENDPOINT, braveUrl, createBraveSearch, parseBraveResponse } from './brave';
import { WebSearchUnavailableError } from './errors';

const recorded = readFileSync(
  new URL('./recorded/brave-kayak-trogir.json', import.meta.url),
  'utf8',
);

function stubFetch(respond: () => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetch = async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return respond();
  };
  return Object.assign(fetch, { calls });
}

describe('braveUrl', () => {
  it('encodes the query and asks for strict web results', () => {
    const url = new URL(braveUrl('kayak trogir (site:croatia.hr OR site:meteo.hr)'));
    expect(`${url.origin}${url.pathname}`).toBe(BRAVE_ENDPOINT);
    expect(url.searchParams.get('q')).toBe('kayak trogir (site:croatia.hr OR site:meteo.hr)');
    expect(url.searchParams.get('result_filter')).toBe('web');
    expect(url.searchParams.get('safesearch')).toBe('strict');
    expect(url.searchParams.get('text_decorations')).toBe('false');
    expect(url.searchParams.get('count')).toBe('10');
  });
});

describe('parseBraveResponse', () => {
  it('reads the recorded hits', () => {
    const hits = parseBraveResponse(JSON.parse(recorded));
    expect(hits.length).toBeGreaterThan(5);
    expect(hits[0]).toMatchObject({
      title: expect.any(String),
      url: expect.stringMatching(/^http/),
    });
  });

  it('treats a missing web section as no hits', () => {
    expect(parseBraveResponse({ type: 'search' })).toEqual([]);
  });

  it('rejects a body that is not a response', () => {
    expect(() => parseBraveResponse({ web: { results: [{ url: 1 }] } })).toThrow(
      WebSearchUnavailableError,
    );
  });
});

describe('createBraveSearch', () => {
  it('sends the token header and returns the hits', async () => {
    const fetch = stubFetch(() => new Response(recorded));
    const hits = await createBraveSearch({ fetch, apiKey: 'secret' }).search('kayak trogir');
    expect(hits.length).toBeGreaterThan(0);
    expect(fetch.calls).toHaveLength(1);
    expect(new URL(fetch.calls[0]?.url ?? '').searchParams.get('q')).toBe('kayak trogir');
    expect(fetch.calls[0]?.init?.headers).toMatchObject({ 'X-Subscription-Token': 'secret' });
    expect(fetch.calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ['a 429', () => new Response('slow down', { status: 429 })],
    ['a 500', () => new Response('down', { status: 500 })],
    ['a thrown fetch', () => Promise.reject(new Error('network'))],
    ['invalid JSON', () => new Response('<html>')],
  ])('is unavailable on %s', async (_, respond) => {
    const search = createBraveSearch({ fetch: stubFetch(respond), apiKey: 'secret' });
    await expect(search.search('kayak trogir')).rejects.toThrow(WebSearchUnavailableError);
  });

  it('keeps the key and query out of the error', async () => {
    const search = createBraveSearch({
      fetch: stubFetch(() => new Response('', { status: 401 })),
      apiKey: 'secret',
    });
    await expect(search.search('kayak trogir')).rejects.toThrow(/^status 401$/);
  });

  it('is unavailable without a key and calls nothing', async () => {
    const fetch = stubFetch(() => new Response(recorded));
    await expect(createBraveSearch({ fetch, apiKey: undefined }).search('x')).rejects.toThrow(
      WebSearchUnavailableError,
    );
    expect(fetch.calls).toHaveLength(0);
  });
});
