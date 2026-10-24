import { describe, expect, it, vi } from 'vitest';
import { haversineM } from './geo';
import {
  parseOvertureRows,
  type RowGroupMetadata,
  rangeOnlyFetch,
  rowGroupsInBbox,
  toJsonSafe,
  withUserAgent,
} from './overture';
import { readRecorded, TROGIR_AREA } from './testing';

type RawRow = {
  id: string;
  confidence: number;
  operating_status: string | null;
  basic_category: string | null;
  bbox: { xmin: number; xmax: number; ymin: number; ymax: number };
};
const recorded = readRecorded('overture') as RawRow[];
const centreOf = (r: RawRow) => ({
  lat: (r.bbox.ymin + r.bbox.ymax) / 2,
  lng: (r.bbox.xmin + r.bbox.xmax) / 2,
});

describe('parseOvertureRows', () => {
  const { rows, skipped } = parseOvertureRows(recorded, TROGIR_AREA);
  const keptIds = new Set(rows.map((r) => r.externalId));

  it('keeps the open, confident, mapped places of the recording', () => {
    expect(rows).toHaveLength(123);
    expect(skipped).toBe(211);
    expect(rows.length + skipped).toBe(recorded.length);
  });

  it('skips low confidence, closed, unmapped and out-of-area rows', () => {
    const low = recorded.filter((r) => r.confidence < 0.6);
    const closed = recorded.filter((r) => r.operating_status && r.operating_status !== 'open');
    const unmapped = recorded.filter((r) => r.basic_category === 'hotel');
    const outside = recorded.filter((r) => haversineM(centreOf(r), TROGIR_AREA.centre) > 3000);
    expect(low.length).toBeGreaterThan(0);
    expect(unmapped.length).toBeGreaterThan(0);
    expect(outside).toHaveLength(20);
    for (const r of [...low, ...closed, ...unmapped, ...outside]) {
      expect(keptIds.has(r.id)).toBe(false);
    }
  });

  it('maps a café to cafe_bar with its row licence', () => {
    expect(rows.find((r) => r.externalId === 'af86c3cb-987b-45a5-8813-d8ac6fb031ad')).toMatchObject(
      {
        source: 'overture',
        name: 'Caffe Bar Jadran',
        placeCategory: 'cafe_bar',
        licence: 'Apache-2.0',
        sourceUrl: null,
      },
    );
  });

  it('skips holiday lets, car hire and boat dealers, but keeps boat hire', () => {
    const place = (id: string, basic: string, primary: string) => ({
      id,
      names: { primary: id },
      basic_category: basic,
      taxonomy: { primary },
      confidence: 0.9,
      operating_status: 'open',
      bbox: { xmin: 16.2516, xmax: 16.2516, ymin: 43.5167, ymax: 43.5167 },
    });
    const { rows: kept } = parseOvertureRows(
      [
        place('Apartman Lina', 'private_lodging', 'holiday_rental_home'),
        place('Apartment 22', 'travel_service', 'vacation_rental_agent'),
        place('Avis', 'rental_service', 'car_rental_service'),
        place('Adriatica Marine', 'vehicle_dealer', 'boat_dealer'),
        place('Salve Croatia', 'rv_park', 'rv_park'),
        place('Trogir Boats', 'recreational_equipment_rental', 'jet_skis_rental'),
      ],
      TROGIR_AREA,
    );
    expect(kept.map((r) => [r.name, r.placeCategory])).toEqual([['Trogir Boats', 'activity']]);
  });

  it('puts no BigInt in any data', () => {
    for (const row of rows) expect(() => JSON.stringify(row.data)).not.toThrow();
  });

  it('reads a BigInt confidence and bbox', () => {
    const raw = {
      id: 'x',
      names: { primary: 'Konoba Test' },
      basic_category: 'restaurant',
      confidence: 0.9,
      operating_status: 'open',
      phones: [1n],
      bbox: { xmin: 16.2516, xmax: 16.2516, ymin: 43.5167, ymax: 43.5167 },
    };
    const { rows: [row] = [] } = parseOvertureRows([raw], TROGIR_AREA);
    expect(row?.data.phones).toEqual([1]);
    expect(row?.licence).toBe('CDLA-Permissive-2.0');
  });
});

describe('toJsonSafe', () => {
  it('converts BigInts, dates and typed arrays', () => {
    expect(
      toJsonSafe({
        a: 1n,
        b: [2n, { c: 3n }],
        d: new Date('2026-10-24T00:00:00Z'),
        e: new Uint8Array([4]),
      }),
    ).toEqual({ a: 1, b: [2, { c: 3 }], d: '2026-10-24T00:00:00.000Z', e: [4] });
  });
});

const stat = (field: string, min: number, max: number) => ({
  meta_data: { path_in_schema: ['bbox', field], statistics: { min_value: min, max_value: max } },
});
const group = (rows: number, x: [number, number], y: [number, number]) => ({
  num_rows: BigInt(rows),
  columns: [
    { meta_data: { path_in_schema: ['id'] } },
    stat('xmin', x[0], x[1]),
    stat('xmax', x[0], x[1]),
    stat('ymin', y[0], y[1]),
    stat('ymax', y[0], y[1]),
  ],
});
const BBOX = { minLng: 16.2, minLat: 43.5, maxLng: 16.3, maxLat: 43.55 };

describe('rowGroupsInBbox', () => {
  it('keeps the groups that touch the bbox and those without statistics', () => {
    const metadata: RowGroupMetadata = {
      row_groups: [
        group(100, [16.1, 16.25], [43.4, 43.52]),
        group(50, [20, 21], [45, 46]),
        { num_rows: 30n, columns: [{ meta_data: { path_in_schema: ['id'] } }] },
      ],
    };
    expect(rowGroupsInBbox(metadata, BBOX)).toEqual([
      { index: 0, rowStart: 0, rowEnd: 100 },
      { index: 2, rowStart: 150, rowEnd: 180 },
    ]);
  });

  it('fails as too large past the row-group cap', () => {
    const metadata = {
      row_groups: Array.from({ length: 41 }, () => group(10, [16.2, 16.3], [43.5, 43.55])),
    };
    expect(() => rowGroupsInBbox(metadata, BBOX)).toThrow(
      expect.objectContaining({ failure: 'too-large' }),
    );
  });
});

describe('rangeOnlyFetch', () => {
  it('refuses a ranged request answered with the whole file, and cancels the body', async () => {
    const cancel = vi.fn(async () => {});
    const response = { status: 200, body: { cancel } } as unknown as Response;
    const fetch = rangeOnlyFetch(async () => response);
    await expect(fetch('https://x.test/f', { headers: { Range: 'bytes=0-9' } })).rejects.toThrow(
      expect.objectContaining({ failure: 'unavailable' }),
    );
    expect(cancel).toHaveBeenCalled();
  });

  it('passes a 206 through', async () => {
    const response = new Response('abc', { status: 206 });
    const fetch = rangeOnlyFetch(async () => response);
    await expect(fetch('https://x.test/f', { headers: { Range: 'bytes=0-2' } })).resolves.toBe(
      response,
    );
  });
});

describe('withUserAgent', () => {
  it('adds the User-Agent and keeps the Range header', async () => {
    const seen = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response('', { status: 206 }),
    );
    await withUserAgent(seen, 'Fetivi/1 (test)')('https://x.test/f', {
      headers: { Range: 'bytes=0-2' },
    });
    const headers = new Headers(seen.mock.calls[0]?.[1]?.headers);
    expect(headers.get('User-Agent')).toBe('Fetivi/1 (test)');
    expect(headers.get('Range')).toBe('bytes=0-2');
  });
});
