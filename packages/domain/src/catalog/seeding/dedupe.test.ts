import { describe, expect, it } from 'vitest';
import {
  assignRows,
  candidateName,
  candidateView,
  type PoolRow,
  pairKey,
  possibleDuplicates,
} from './dedupe';
import { haversineM, type LatLng } from './geo';
import { parseRecorded } from './testing';
import { SEEDING_SOURCES, type SeedingSource } from './vocabulary';

const SALDUN = { lat: 43.51046, lng: 16.25093 };
/** A point `m` metres north of `p`. */
const north = (p: LatLng, m: number) => ({ lat: p.lat + m / 111_195, lng: p.lng });

const row = (id: string, source: SeedingSource, name: string, location: LatLng): PoolRow => ({
  id,
  source,
  name,
  location,
  candidateId: null,
  recordId: null,
});
const none = { rows: [], records: [] };

describe('assignRows', () => {
  it('groups one place listed by two sources 40 m apart', () => {
    const result = assignRows(
      [
        row('a', 'bathing_water', 'Saldun', SALDUN),
        row('b', 'osm', 'Plaža Saldun', north(SALDUN, 40)),
      ],
      none,
    );
    expect(result.newCandidates).toEqual([['a', 'b']]);
  });

  it('keeps the same pair apart at 400 m, with no possible duplicate', () => {
    const far = north(SALDUN, 400);
    const result = assignRows(
      [row('a', 'bathing_water', 'Saldun', SALDUN), row('b', 'osm', 'Plaža Saldun', far)],
      none,
    );
    expect(result.newCandidates).toEqual([['a'], ['b']]);
    const dupes = possibleDuplicates(
      [
        { id: 'c1', rows: [{ name: 'Saldun', location: SALDUN }] },
        { id: 'c2', rows: [{ name: 'Plaža Saldun', location: far }] },
      ],
      new Set(),
    );
    expect(dupes.size).toBe(0);
  });

  it('attaches a row near a matching record instead of proposing it', () => {
    const trs = { lat: 43.5172, lng: 16.2507 };
    const result = assignRows([row('a', 'osm', 'Restaurant Trs', north(trs, 30))], {
      rows: [],
      records: [{ id: 'rec', title: 'Konoba Trs', location: trs }],
    });
    expect(result).toEqual({
      toRecord: [{ rowId: 'a', recordId: 'rec' }],
      toCandidate: [],
      newCandidates: [],
    });
  });

  it('joins a row to an existing candidate of another source', () => {
    const existing = { ...row('x', 'osm', 'Šaldun', SALDUN), candidateId: 'cand' };
    const result = assignRows([row('a', 'bathing_water', 'Saldun', north(SALDUN, 60))], {
      rows: [existing],
      records: [],
    });
    expect(result.toCandidate).toEqual([{ rowId: 'a', candidateId: 'cand' }]);
    expect(result.newCandidates).toEqual([]);
  });

  it('never auto-merges two rows of one source, but flags them', () => {
    const result = assignRows(
      [row('a', 'osm', 'Šaldun', SALDUN), row('b', 'osm', 'Šaldun', north(SALDUN, 20))],
      none,
    );
    expect(result.newCandidates).toEqual([['a'], ['b']]);
    const dupes = possibleDuplicates(
      [
        { id: 'c1', rows: [{ name: 'Šaldun', location: SALDUN }] },
        { id: 'c2', rows: [{ name: 'Šaldun', location: north(SALDUN, 20) }] },
      ],
      new Set(),
    );
    expect(dupes.get('c1')).toEqual([
      { otherId: 'c2', distanceM: expect.closeTo(20, 0), score: 1 },
    ]);
    expect(dupes.get('c2')?.[0]?.otherId).toBe('c1');
  });
});

describe('possibleDuplicates', () => {
  const pair = [
    { id: 'c1', rows: [{ name: 'Kamerlengo Fortress', location: SALDUN }] },
    { id: 'c2', rows: [{ name: 'Tvrđava Kamerlengo', location: north(SALDUN, 120) }] },
  ];

  it('flags a translated name 120 m away', () => {
    expect(possibleDuplicates(pair, new Set()).get('c1')?.[0]?.otherId).toBe('c2');
  });

  it('leaves out a kept-apart pair', () => {
    expect(possibleDuplicates(pair, new Set([pairKey('c2', 'c1')])).size).toBe(0);
  });
});

describe('candidateView', () => {
  it('takes the name from bathing water and the category from OSM', () => {
    const view = candidateView([
      { source: 'overture', name: 'Saldun Beach', location: SALDUN, placeCategory: 'beach' },
      { source: 'osm', name: 'Šaldun', location: north(SALDUN, 10), placeCategory: 'nature' },
      {
        source: 'bathing_water',
        name: 'Saldun',
        location: north(SALDUN, 5),
        placeCategory: 'beach',
      },
    ] as const);
    expect(view.name).toBe('Saldun');
    expect(view.location).toEqual(north(SALDUN, 5));
    expect(view.placeCategory).toBe('nature');
    expect(view.sources.map((s) => s.source)).toEqual(['bathing_water', 'osm', 'overture']);
  });

  it('names a candidate with two rows of one source the same whatever the row order', () => {
    const ace = {
      source: 'osm',
      name: 'Ace',
      location: SALDUN,
      placeCategory: 'activity',
    } as const;
    const club = { ...ace, name: 'Croatia Yacht Club' } as const;
    expect(candidateView([club, ace]).name).toBe('Ace');
    expect(candidateView([ace, club]).name).toBe('Ace');
    expect(candidateName([club, ace])).toBe('Ace');
    expect(candidateView([club, ace]).sources.map((s) => s.name)).toEqual([
      'Ace',
      'Croatia Yacht Club',
    ]);
  });
});

describe('the recorded Trogir set', () => {
  it('groups the three sources into candidates (regression guard)', () => {
    let n = 0;
    const rows = SEEDING_SOURCES.flatMap((source) =>
      parseRecorded(source).rows.map((r) => row(`r${n++}`, r.source, r.name, r.location)),
    );
    const { newCandidates, toRecord, toCandidate } = assignRows(rows, none);
    const sourceOf = new Map(rows.map((r) => [r.id, r.source]));
    const multi = newCandidates.filter((g) => new Set(g.map((id) => sourceOf.get(id))).size > 1);
    expect(toRecord).toEqual([]);
    expect(toCandidate).toEqual([]);
    expect({
      rows: rows.length,
      groups: newCandidates.length,
      multiSource: multi.length,
    }).toEqual({ rows: 321, groups: 275, multiSource: 46 });
    expect(newCandidates.flat()).toHaveLength(rows.length);
    for (const group of newCandidates) {
      const sources = group.map((id) => sourceOf.get(id));
      expect(new Set(sources).size).toBe(sources.length);
    }
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const group of multi) {
      const [a, b] = group.map((id) => byId.get(id));
      if (a && b) expect(haversineM(a.location, b.location)).toBeLessThanOrEqual(200);
    }
  });
});
