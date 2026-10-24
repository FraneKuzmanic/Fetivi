import { createEgress } from '@fetivi/egress';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPages } from './fetch-pages';
import { allowlistFor, type SourceRef } from './sources';
import { type RecordedAnswer, recordedPagesFetch } from './testing';
import { DRAFTING_LIMITS } from './vocabulary';

const VENUE = 'https://www.svdominik.com/';
const UA = 'Fetivi/test';

afterEach(() => vi.unstubAllGlobals());

/** The real egress, scoped to the refs' hosts, over a recorded global fetch. */
function setup(refs: SourceRef[], map: Record<string, RecordedAnswer>) {
  const recorded = recordedPagesFetch(map);
  vi.stubGlobal('fetch', recorded);
  return { fetch: createEgress({ allowlist: allowlistFor(refs) }).fetch, recorded };
}

const venue: SourceRef = { url: VENUE, kind: 'venue' };

describe('fetchPages', () => {
  it('reads the venue and its contact, about and menu pages', async () => {
    const { fetch, recorded } = setup([venue], {
      [VENUE]: { file: 'konoba-venue.html' },
      [`${VENUE}contact/`]: { file: 'konoba-contact.html' },
      [`${VENUE}about-us/`]: { status: 404 },
      [`${VENUE}menu/`]: { body: '<p>tiny</p>' },
    });
    const { pages, failed } = await fetchPages(fetch, UA, [venue]);
    expect(pages.map((p) => p.url)).toEqual([VENUE, `${VENUE}contact/`]);
    expect(pages[1]?.text).toContain('Sunday closed');
    expect(failed).toBe(1);
    expect(recorded.requests).toEqual([
      VENUE,
      `${VENUE}contact/`,
      `${VENUE}about-us/`,
      `${VENUE}menu/`,
    ]);
  });

  it('blocks a redirect off the allowlist and counts it as failed', async () => {
    const { fetch, recorded } = setup([venue], { [VENUE]: { redirect: 'https://evil.example/' } });
    const { pages, failed } = await fetchPages(fetch, UA, [venue]);
    expect(pages).toEqual([]);
    expect(failed).toBe(1);
    expect(recorded.requests).toEqual([VENUE]);
  });

  it('follows a bare-to-www redirect and records the page actually read', async () => {
    const bare: SourceRef = { url: 'https://svdominik.com/', kind: 'venue' };
    const { fetch } = setup([bare], {
      'https://svdominik.com/': { redirect: VENUE },
      [VENUE]: { file: 'konoba-venue.html' },
    });
    const { pages } = await fetchPages(fetch, UA, [bare]);
    expect(pages[0]?.url).toBe(VENUE);
  });

  it('skips a non-HTML response', async () => {
    const { fetch } = setup([venue], {
      [VENUE]: { body: '%PDF-1.7', contentType: 'application/pdf' },
    });
    expect(await fetchPages(fetch, UA, [venue])).toEqual({ pages: [], failed: 0 });
  });

  it('drops a login wall under the useful minimum', async () => {
    const social: SourceRef = { url: 'https://www.facebook.com/svdominik', kind: 'social' };
    const { fetch } = setup([social], {
      [social.url]: { body: '<title>Facebook</title><p>Log in to continue.</p>' },
    });
    expect((await fetchPages(fetch, UA, [social])).pages).toEqual([]);
  });

  it('holds the per-task character cap', async () => {
    const refs: SourceRef[] = Array.from({ length: 5 }, (_, i) => ({
      url: `https://v${i}.hr/`,
      kind: 'tourist_board',
    }));
    const big = { body: `<p>${'Dalmatian stew. '.repeat(2000)}</p>` };
    const { fetch, recorded } = setup(refs, Object.fromEntries(refs.map((r) => [r.url, big])));
    const { pages } = await fetchPages(fetch, UA, refs);
    const total = pages.reduce((n, p) => n + p.text.length, 0);
    expect(total).toBe(DRAFTING_LIMITS.charsPerTask);
    expect(pages).toHaveLength(4);
    expect(recorded.requests).toHaveLength(4);
  });

  it('never throws on a network error', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed');
    });
    const fetch = createEgress({ allowlist: allowlistFor([venue]) }).fetch;
    expect(await fetchPages(fetch, UA, [venue])).toEqual({ pages: [], failed: 1 });
  });
});
