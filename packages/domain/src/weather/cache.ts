import type { Egress } from '@fetivi/egress';
import { WeatherFeedError } from './errors';

// A per-process cache in front of the weather feeds. MET Norway's terms ask clients to respect
// `Expires`, to revalidate with `If-Modified-Since`, and to identify themselves; DHMZ asks
// nothing, and gets plain TTLs. A failed refresh serves the last body for a while
// (stale-if-error), and never retries in a loop: a 403 or 429 from MET takes the same path.

export interface FeedPolicy {
  /** Fresh for this long; for a conditional feed only when the answer has no usable Expires. */
  ttlMs: number;
  /** How old a body may be and still stand in when a refresh fails. */
  staleIfErrorMs: number;
  /** MET Norway: freshness from Expires, revalidation with If-Modified-Since. */
  conditional?: boolean;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const FEED_POLICIES = {
  warnings: { ttlMs: 10 * MINUTE, staleIfErrorMs: HOUR },
  sea: { ttlMs: HOUR, staleIfErrorMs: 6 * HOUR },
  uv: { ttlMs: 30 * MINUTE, staleIfErrorMs: 3 * HOUR },
  metno: { ttlMs: 30 * MINUTE, staleIfErrorMs: 6 * HOUR, conditional: true },
} as const satisfies Record<string, FeedPolicy>;

/** MET URLs vary by point; the oldest entry goes first past this. */
export const FEED_CACHE_MAX_ENTRIES = 256;

export interface FeedCacheOptions {
  fetch: Egress['fetch'];
  /** Sent on every request; MET Norway blocks generic agents. */
  userAgent: string;
  clock: () => Date;
}

export interface FeedCache {
  get(url: string, policy: FeedPolicy): Promise<string>;
}

interface Entry {
  body: string;
  fetchedAt: number;
  freshUntil: number;
  lastModified: string | null;
}

export function createFeedCache(options: FeedCacheOptions): FeedCache {
  const entries = new Map<string, Entry>();
  const inFlight = new Map<string, Promise<string>>();

  function freshUntil(response: Response, policy: FeedPolicy, now: number): number {
    if (policy.conditional) {
      const expires = Date.parse(response.headers.get('expires') ?? '');
      if (Number.isFinite(expires) && expires > now) return expires;
    }
    return now + policy.ttlMs;
  }

  function store(url: string, entry: Entry): void {
    entries.delete(url);
    entries.set(url, entry);
    if (entries.size <= FEED_CACHE_MAX_ENTRIES) return;
    let oldest: string | null = null;
    let oldestAt = Number.POSITIVE_INFINITY;
    for (const [key, value] of entries) {
      if (value.fetchedAt < oldestAt) {
        oldest = key;
        oldestAt = value.fetchedAt;
      }
    }
    if (oldest !== null) entries.delete(oldest);
  }

  async function refresh(url: string, policy: FeedPolicy): Promise<string> {
    const cached = entries.get(url);
    const headers: Record<string, string> = { 'User-Agent': options.userAgent };
    if (policy.conditional && cached?.lastModified) {
      headers['If-Modified-Since'] = cached.lastModified;
    }
    let failure: string;
    try {
      const response = await options.fetch(url, { headers });
      const now = options.clock().getTime();
      if (response.status === 304 && cached) {
        store(url, { ...cached, fetchedAt: now, freshUntil: freshUntil(response, policy, now) });
        return cached.body;
      }
      if (response.ok) {
        const body = await response.text();
        store(url, {
          body,
          fetchedAt: now,
          freshUntil: freshUntil(response, policy, now),
          lastModified: response.headers.get('last-modified'),
        });
        return body;
      }
      failure = `status ${response.status}`;
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
    }
    if (cached && options.clock().getTime() - cached.fetchedAt <= policy.staleIfErrorMs) {
      return cached.body;
    }
    throw new WeatherFeedError(`${new URL(url).host} feed unavailable: ${failure}`);
  }

  return {
    get(url, policy) {
      const cached = entries.get(url);
      if (cached && options.clock().getTime() < cached.freshUntil) {
        return Promise.resolve(cached.body);
      }
      const pending = inFlight.get(url);
      if (pending) return pending;
      const promise = refresh(url, policy).finally(() => inFlight.delete(url));
      inFlight.set(url, promise);
      return promise;
    },
  };
}
