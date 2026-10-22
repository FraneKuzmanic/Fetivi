import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { datesIn, FerryFeedError, linesIn, parseJadrolinijaFeed } from './jadrolinija';
import { FERRY_OPERATOR_INFO } from './vocabulary';

const recorded = (name: string) =>
  readFileSync(new URL(`./recorded/${name}`, import.meta.url), 'utf8');
const SUSPENSION = recorded('jadrolinija-vijesti-suspension.xml');
const LIVE = recorded('jadrolinija-vijesti.xml');

describe('parseJadrolinijaFeed', () => {
  it('reads the suspension bulletin, its pubDate as local time', () => {
    const [bulletin, ...rest] = parseJadrolinijaFeed(SUSPENSION);
    expect(rest).toEqual([]);
    expect(bulletin).toMatchObject({
      id: 'urn:uuid:81',
      title: 'Linije u prekidu, 15.10.2026',
      url: 'https://www.jadrolinija.hr/hr/novost/linije-u-prekidu15102026',
      // "16:14:47 Z" is Zagreb wall-clock time, not UTC.
      publishedLocal: '2026-10-14T16:14',
    });
    expect(bulletin?.text).toContain('Katamaranska linija 9603');
    expect(bulletin?.text).not.toContain('<p>');
  });

  it('reads the live recording, which names no line', () => {
    const [bulletin] = parseJadrolinijaFeed(LIVE);
    expect(bulletin).toMatchObject({
      id: 'urn:uuid:82',
      title: 'Svi Jadrolinijini brodovi plove prema redu plovidbe',
      url: 'https://www.jadrolinija.hr/news-single/stanje-u-pomorskom-prometu',
      publishedLocal: '2026-10-14T16:10',
    });
    expect(linesIn(bulletin?.text ?? '', 'jadrolinija')).toEqual([]);
  });

  it('falls back to the official page for a link to another host or over http', () => {
    for (const link of [
      'https://evil.example/hr/novost/x',
      'http://www.jadrolinija.hr/hr/novost/x',
      'javascript:alert(1)',
    ]) {
      const xml = SUSPENSION.replace(
        'https://www.jadrolinija.hr/hr/novost/linije-u-prekidu15102026',
        link,
      );
      expect(parseJadrolinijaFeed(xml)[0]?.url).toBe(FERRY_OPERATOR_INFO.jadrolinija.url);
    }
  });

  it('uses the link as the id when there is no guid', () => {
    const xml = SUSPENSION.replace('<guid isPermaLink="false">urn:uuid:81</guid>', '');
    expect(parseJadrolinijaFeed(xml)[0]?.id).toBe(
      'https://www.jadrolinija.hr/hr/novost/linije-u-prekidu15102026',
    );
  });

  it('throws FerryFeedError on malformed XML or a non-RSS document', () => {
    expect(() => parseJadrolinijaFeed('<rss><channel>')).toThrow(FerryFeedError);
    expect(() => parseJadrolinijaFeed('<html><body>Not found</body></html>')).toThrow(
      FerryFeedError,
    );
  });
});

describe('linesIn', () => {
  it('finds 9603 and ignores years, times and dates', () => {
    const [bulletin] = parseJadrolinijaFeed(SUSPENSION);
    expect(linesIn(bulletin?.text ?? '', 'jadrolinija')).toEqual(['9603']);
    expect(linesIn('2026 06:00 15.10.2026 1000', 'jadrolinija')).toEqual([]);
  });

  it("keeps only the operator's lines", () => {
    expect(linesIn('Linije 635 i 9604 u prekidu', 'jadrolinija')).toEqual(['635']);
    expect(linesIn('Linije 635 i 9604 u prekidu', 'tp_line')).toEqual(['9604']);
  });
});

describe('datesIn', () => {
  it('reads d.m.yyyy dates once each, valid ones only', () => {
    expect(datesIn('Linije u prekidu, 15.10.2026', '2026-10-14')).toEqual(['2026-10-15']);
    expect(datesIn('1.11.2026. i 01.11.2026 te 31.2.2026', '2026-10-14')).toEqual(['2026-11-01']);
  });

  it('falls back to the publication day when the text has no date', () => {
    expect(datesIn('Linija 9603 u prekidu', '2026-10-14')).toEqual(['2026-10-14']);
  });
});
