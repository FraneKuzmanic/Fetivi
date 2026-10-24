import { describe, expect, it } from 'vitest';
import { allowlistFor, candidateSourceUrls, classify, recordSourceUrls } from './sources';
import { DRAFTING_LIMITS } from './vocabulary';

const osm = (tags: Record<string, string>) => ({
  source: 'osm',
  data: { tags },
  sourceUrl: 'https://www.openstreetmap.org/node/1',
});

describe('candidateSourceUrls', () => {
  it('puts the venue site first, then the social page from a bare handle', () => {
    expect(
      candidateSourceUrls([
        osm({ 'contact:facebook': 'konobatrs', website: 'https://konobatrs.hr' }),
      ]),
    ).toEqual([
      { url: 'https://konobatrs.hr/', kind: 'venue' },
      { url: 'https://www.facebook.com/konobatrs', kind: 'social' },
    ]);
  });

  it('drops shared platforms such as tripadvisor', () => {
    expect(
      candidateSourceUrls([
        {
          source: 'overture',
          data: { websites: ['https://www.tripadvisor.com/Restaurant-x'], socials: null },
          sourceUrl: null,
        },
      ]),
    ).toEqual([]);
  });

  it('marks a tourist-board page as tourist_board, after the venue', () => {
    const refs = candidateSourceUrls([
      osm({ url: 'https://visittrogir.hr/en/konoba-trs', website: 'konobatrs.hr' }),
    ]);
    expect(refs.map((r) => r.kind)).toEqual(['venue', 'tourist_board']);
  });

  it('upgrades http to https', () => {
    expect(candidateSourceUrls([osm({ website: 'http://konobatrs.hr/' })])[0]?.url).toBe(
      'https://konobatrs.hr/',
    );
  });

  it('never includes the open-data rows’ own URLs', () => {
    const refs = candidateSourceUrls([
      osm({ website: 'https://www.openstreetmap.org/node/1' }),
      { source: 'bathing_water', data: {}, sourceUrl: 'https://www.eea.europa.eu/x' },
    ]);
    expect(refs).toEqual([]);
  });

  it('caps the refs per task', () => {
    const refs = candidateSourceUrls([
      {
        source: 'overture',
        data: { websites: Array.from({ length: 9 }, (_, i) => `https://v${i}.hr/`), socials: [] },
      },
    ]);
    expect(refs).toHaveLength(DRAFTING_LIMITS.pagesPerTask);
  });

  it('deduplicates the same page', () => {
    expect(
      candidateSourceUrls([
        osm({ website: 'https://konobatrs.hr/' }),
        { source: 'overture', data: { websites: ['https://konobatrs.hr/'] } },
      ]),
    ).toHaveLength(1);
  });
});

describe('classify', () => {
  it('drops credentials, ports and non-URLs', () => {
    expect(classify('https://user:pw@konobatrs.hr/')).toBeNull();
    expect(classify('https://konobatrs.hr:8443/')).toBeNull();
    expect(classify('ftp://konobatrs.hr/')).toBeNull();
    expect(classify('not a url')).toBeNull();
  });
});

describe('recordSourceUrls', () => {
  it('reads the website, field sources and rows, and drops open-data URLs', () => {
    const refs = recordSourceUrls(
      {
        websiteUrl: 'https://konobatrs.hr/',
        fieldSources: {
          phone: 'https://konobatrs.hr/kontakt',
          location: 'https://www.openstreetmap.org/node/1',
        },
      },
      [osm({ 'contact:instagram': '@konoba.trs' })],
    );
    expect(refs.map((r) => r.url)).toEqual([
      'https://konobatrs.hr/',
      'https://konobatrs.hr/kontakt',
      'https://www.instagram.com/konoba.trs',
    ]);
  });
});

describe('allowlistFor', () => {
  it('adds the www twin of each host', () => {
    expect(
      allowlistFor([
        { url: 'https://konobatrs.hr/', kind: 'venue' },
        { url: 'https://www.facebook.com/konobatrs', kind: 'social' },
      ]).sort(),
    ).toEqual(['facebook.com', 'konobatrs.hr', 'www.facebook.com', 'www.konobatrs.hr']);
  });
});
