import { describe, expect, it } from 'vitest';
import { filterHits, type RawWebHit } from './results';
import { FALLBACK_LIMITS, FALLBACK_SITES } from './vocabulary';

const hit = (url: string, title = 'A page', description = 'About it'): RawWebHit => ({
  title,
  url,
  description,
});

describe('filterHits', () => {
  it('keeps an allowlisted https page with its source', () => {
    const [result] = filterHits([hit('https://www.visittrogir.hr/en/kayak')], FALLBACK_SITES);
    expect(result).toEqual({
      title: 'A page',
      snippet: 'About it',
      url: 'https://www.visittrogir.hr/en/kayak',
      source: { host: 'visittrogir.hr', kind: 'tourist_board' },
    });
  });

  it('upgrades http to https', () => {
    const [result] = filterHits([hit('http://www.croatia.hr/en-gb/trogir')], FALLBACK_SITES);
    expect(result?.url).toBe('https://www.croatia.hr/en-gb/trogir');
  });

  it.each([
    'https://croatia.hr.evil.com/',
    'https://evilcroatia.hr/',
    'ftp://croatia.hr/file',
    'javascript:alert(1)',
    'https://user:pw@croatia.hr/',
    'https://croatia.hr:8443/',
    'https://www.tripadvisor.com/Trogir',
    'not a url',
  ])('drops %s', (url) => {
    expect(filterHits([hit(url)], FALLBACK_SITES)).toEqual([]);
  });

  it('checks only against the sites it is given', () => {
    const sites = FALLBACK_SITES.filter((s) => s.host === 'meteo.hr');
    expect(filterHits([hit('https://croatia.hr/')], sites)).toEqual([]);
  });

  it('strips markup and decodes entities', () => {
    const [result] = filterHits(
      [
        hit(
          'https://croatia.hr/',
          '<strong>Kayak</strong> &amp; SUP',
          'Rent &#39;n&#x27; go&nbsp;now',
        ),
      ],
      FALLBACK_SITES,
    );
    expect(result?.title).toBe('Kayak & SUP');
    expect(result?.snippet).toBe("Rent 'n' go now");
  });

  it('caps at five and dedupes by URL', () => {
    const raw = [
      hit('https://croatia.hr/a'),
      hit('http://croatia.hr/a'),
      ...Array.from({ length: 8 }, (_, i) => hit(`https://croatia.hr/p${i}`)),
    ];
    const results = filterHits(raw, FALLBACK_SITES);
    expect(results).toHaveLength(5);
    expect(results.filter((r) => r.url === 'https://croatia.hr/a')).toHaveLength(1);
  });
});

describe('filterHits text', () => {
  it('truncates long titles with an ellipsis', () => {
    const [result] = filterHits([hit('https://croatia.hr/', 'x'.repeat(200))], FALLBACK_SITES);
    expect(result?.title).toHaveLength(FALLBACK_LIMITS.titleMaxChars);
    expect(result?.title.endsWith('…')).toBe(true);
  });

  it('removes encoded markup too', () => {
    const [result] = filterHits(
      [hit('https://croatia.hr/', 'Ferry &lt;script&gt;x&lt;/script&gt; times')],
      FALLBACK_SITES,
    );
    expect(result?.title).toBe('Ferry times');
  });
});
