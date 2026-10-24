import { describe, expect, it } from 'vitest';
import { SourceError } from './errors';
import { haversineM } from './geo';
import { overpassQuery, parseOverpass } from './osm';
import { readRecorded, TROGIR_AREA } from './testing';

const recorded = readRecorded('osm');

describe('overpassQuery', () => {
  it('asks for every rule key around the centre and prints way centres', () => {
    const q = overpassQuery(TROGIR_AREA);
    expect(q).toContain(
      'nwr(around:3000,43.5167,16.2516)["natural"~"^(beach|peak|cave_entrance)$"];',
    );
    expect(q).toContain('["amenity"~"^(restaurant|fast_food|cafe|bar|pub|ice_cream|nightclub|');
    expect(q.endsWith('out center tags;')).toBe(true);
  });
});

describe('parseOverpass', () => {
  const { rows, skipped } = parseOverpass(recorded, TROGIR_AREA);

  it('keeps the named, categorised elements of the recording and counts the rest', () => {
    expect(rows).toHaveLength(187);
    expect(skipped).toBe(55);
  });

  it('maps the Šaldun beach way, using its centre', () => {
    const saldun = rows.find((r) => r.externalId === 'way/1196163912');
    expect(saldun).toMatchObject({
      source: 'osm',
      name: 'Šaldun',
      placeCategory: 'beach',
      licence: 'ODbL-1.0',
      sourceUrl: 'https://www.openstreetmap.org/way/1196163912',
    });
    expect(saldun?.data).toHaveProperty('tags.natural', 'beach');
  });

  it('keeps only rows within the radius, all under ODbL', () => {
    for (const row of rows) {
      expect(haversineM(row.location, TROGIR_AREA.centre)).toBeLessThanOrEqual(3000);
      expect(row.licence).toBe('ODbL-1.0');
    }
  });

  it('skips unnamed beaches and elements outside the radius', () => {
    const json = {
      elements: [
        { type: 'way', id: 1, center: { lat: 43.51, lon: 16.25 }, tags: { natural: 'beach' } },
        { type: 'node', id: 2, lat: 43.7, lon: 16.25, tags: { natural: 'beach', name: 'Far' } },
        { type: 'node', id: 3, lat: 43.51, lon: 16.25, tags: { highway: 'bus_stop', name: 'X' } },
      ],
    };
    expect(parseOverpass(json, TROGIR_AREA)).toEqual({ rows: [], skipped: 3 });
  });

  it('rejects a response of the wrong shape', () => {
    expect(() => parseOverpass({ remark: 'runtime error' }, TROGIR_AREA)).toThrow(SourceError);
  });
});
