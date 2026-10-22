import type { Egress } from '@fetivi/egress';
import { describe, expect, it } from 'vitest';
import {
  createFeedCache,
  FEED_CACHE_MAX_ENTRIES,
  FEED_FAILURE_BACKOFF_MS,
  FEED_POLICIES,
} from './cache';
import { WeatherFeedError } from './errors';

const URL_A = 'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=43.52&lon=16.25';
const AGENT = 'Fetivi/0.1 (+https://github.com/FraneKuzmanic/Fetivi)';
const START = Date.parse('2026-10-22T20:00:00Z');
const MINUTE = 60_000;

type Answer = () => Response | Promise<Response>;

function harness() {
  let now = START;
  const answers: Answer[] = [];
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
    const answer = answers.shift();
    if (!answer) throw new Error('no answer queued');
    return answer();
  }) as Egress['fetch'];
  const cache = createFeedCache({ fetch, userAgent: AGENT, clock: () => new Date(now) });
  return {
    cache,
    calls,
    queue: (...a: Answer[]) => answers.push(...a),
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const ok =
  (body: string, headers: Record<string, string> = {}) =>
  () =>
    new Response(body, { status: 200, headers });
const status = (code: number) => () => new Response(code === 304 ? null : 'x', { status: code });

describe('createFeedCache', () => {
  it('serves a fresh body without a second request, with the User-Agent', async () => {
    const h = harness();
    h.queue(ok('one'));
    expect(await h.cache.get(URL_A, FEED_POLICIES.sea)).toBe('one');
    h.advance(59 * MINUTE);
    expect(await h.cache.get(URL_A, FEED_POLICIES.sea)).toBe('one');
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]?.headers['User-Agent']).toBe(AGENT);
  });

  it('refetches after the TTL', async () => {
    const h = harness();
    h.queue(ok('one'), ok('two'));
    await h.cache.get(URL_A, FEED_POLICIES.warnings);
    h.advance(11 * MINUTE);
    expect(await h.cache.get(URL_A, FEED_POLICIES.warnings)).toBe('two');
    expect(h.calls[1]?.headers['If-Modified-Since']).toBeUndefined();
  });

  it('honours Expires and revalidates with If-Modified-Since; a 304 reuses the body', async () => {
    const h = harness();
    const lastModified = 'Thu, 22 Oct 2026 20:00:00 GMT';
    h.queue(
      ok('forecast', {
        Expires: new Date(START + 5 * MINUTE).toUTCString(),
        'Last-Modified': lastModified,
      }),
      () =>
        new Response(null, {
          status: 304,
          headers: { Expires: new Date(START + 50 * MINUTE).toUTCString() },
        }),
    );
    await h.cache.get(URL_A, FEED_POLICIES.metno);
    h.advance(4 * MINUTE);
    await h.cache.get(URL_A, FEED_POLICIES.metno);
    expect(h.calls).toHaveLength(1);

    h.advance(2 * MINUTE);
    expect(await h.cache.get(URL_A, FEED_POLICIES.metno)).toBe('forecast');
    expect(h.calls[1]?.headers['If-Modified-Since']).toBe(lastModified);

    // Fresh again until the new Expires.
    h.advance(40 * MINUTE);
    await h.cache.get(URL_A, FEED_POLICIES.metno);
    expect(h.calls).toHaveLength(2);
  });

  it('falls back to the TTL when Expires is missing or past', async () => {
    const h = harness();
    h.queue(ok('a', { Expires: new Date(START - MINUTE).toUTCString() }), ok('b'));
    await h.cache.get(URL_A, FEED_POLICIES.metno);
    h.advance(29 * MINUTE);
    expect(await h.cache.get(URL_A, FEED_POLICIES.metno)).toBe('a');
    expect(h.calls).toHaveLength(1);
  });

  it('serves the old body on an error inside the stale window, and throws past it', async () => {
    const h = harness();
    h.queue(ok('old'), status(500), status(403), () => Promise.reject(new Error('reset')));
    await h.cache.get(URL_A, FEED_POLICIES.warnings);
    h.advance(11 * MINUTE);
    expect(await h.cache.get(URL_A, FEED_POLICIES.warnings)).toBe('old');
    h.advance(30 * MINUTE);
    expect(await h.cache.get(URL_A, FEED_POLICIES.warnings)).toBe('old');
    h.advance(30 * MINUTE);
    await expect(h.cache.get(URL_A, FEED_POLICIES.warnings)).rejects.toThrow(WeatherFeedError);
  });

  it('throws on an error with nothing cached', async () => {
    const h = harness();
    h.queue(status(429));
    await expect(h.cache.get(URL_A, FEED_POLICIES.metno)).rejects.toThrow(WeatherFeedError);
  });

  it('backs off after a failure instead of asking again on every get', async () => {
    const h = harness();
    h.queue(ok('old'), status(429), ok('new'));
    await h.cache.get(URL_A, FEED_POLICIES.metno);
    h.advance(31 * MINUTE);
    expect(await h.cache.get(URL_A, FEED_POLICIES.metno)).toBe('old');
    h.advance(FEED_FAILURE_BACKOFF_MS - 1);
    expect(await h.cache.get(URL_A, FEED_POLICIES.metno)).toBe('old');
    expect(h.calls).toHaveLength(2);
    h.advance(1);
    expect(await h.cache.get(URL_A, FEED_POLICIES.metno)).toBe('new');
    expect(h.calls).toHaveLength(3);
  });

  it('backs off with nothing cached too, throwing without a request', async () => {
    const h = harness();
    h.queue(status(403));
    await expect(h.cache.get(URL_A, FEED_POLICIES.metno)).rejects.toThrow(WeatherFeedError);
    h.advance(MINUTE);
    await expect(h.cache.get(URL_A, FEED_POLICIES.metno)).rejects.toThrow('status 403');
    expect(h.calls).toHaveLength(1);
  });

  it('makes one request for concurrent gets', async () => {
    const h = harness();
    let release: (r: Response) => void = () => {};
    h.queue(() => new Promise<Response>((resolve) => (release = resolve)));
    const both = Promise.all([
      h.cache.get(URL_A, FEED_POLICIES.sea),
      h.cache.get(URL_A, FEED_POLICIES.sea),
    ]);
    await Promise.resolve();
    release(new Response('shared'));
    expect(await both).toEqual(['shared', 'shared']);
    expect(h.calls).toHaveLength(1);
  });

  it('evicts the oldest entry past the bound', async () => {
    const h = harness();
    for (let i = 0; i <= FEED_CACHE_MAX_ENTRIES; i++) {
      h.queue(ok(`body ${i}`));
      await h.cache.get(`https://vrijeme.hr/${i}.xml`, FEED_POLICIES.sea);
      h.advance(1);
    }
    expect(await h.cache.get('https://vrijeme.hr/1.xml', FEED_POLICIES.sea)).toBe('body 1');
    h.queue(ok('again'));
    expect(await h.cache.get('https://vrijeme.hr/0.xml', FEED_POLICIES.sea)).toBe('again');
  });
});
