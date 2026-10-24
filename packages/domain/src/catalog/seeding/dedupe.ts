import type { PlaceCategory } from '../vocabulary';
import { haversineM, type LatLng } from './geo';
import { nameSimilarity } from './similarity';
import {
  CATEGORY_PRECEDENCE,
  LOCATION_PRECEDENCE,
  NAME_PRECEDENCE,
  SEEDING_MATCH,
  type SeedingSource,
} from './vocabulary';

// Pure grouping decisions over open-data rows: no DB. The store loads the pool, calls these and
// applies the result.

export interface PoolRow {
  id: string;
  source: SeedingSource;
  name: string;
  location: LatLng;
  candidateId: string | null;
  recordId: string | null;
}

/** An existing place record of the destination. Read only: seeding never writes it. */
export interface RecordRef {
  id: string;
  title: string;
  location: LatLng;
}

export interface Assignment {
  toRecord: { rowId: string; recordId: string }[];
  toCandidate: { rowId: string; candidateId: string }[];
  /** Groups of row ids, each becoming one new candidate. */
  newCandidates: string[][];
}

/** About 320–450 m around Dalmatia: the 3×3 neighbourhood covers every threshold (≤ 250 m). */
const CELL_DEG = 0.004;
const cellOf = (p: LatLng) => [Math.floor(p.lat / CELL_DEG), Math.floor(p.lng / CELL_DEG)];

class Grid<T> {
  private cells = new Map<string, T[]>();
  add(p: LatLng, item: T) {
    const [a, b] = cellOf(p);
    const key = `${a},${b}`;
    const list = this.cells.get(key);
    if (list) list.push(item);
    else this.cells.set(key, [item]);
  }
  near(p: LatLng): T[] {
    const [a = 0, b = 0] = cellOf(p);
    const out: T[] = [];
    for (let i = a - 1; i <= a + 1; i++) {
      for (let j = b - 1; j <= b + 1; j++) out.push(...(this.cells.get(`${i},${j}`) ?? []));
    }
    return out;
  }
}

interface Group {
  /** An existing candidate id, or null for a group formed in this run. */
  candidateId: string | null;
  rowIds: string[];
  sources: Set<SeedingSource>;
}

interface Match {
  score: number;
  distanceM: number;
}

const better = (a: Match, b: Match | null) =>
  !b || a.score > b.score || (a.score === b.score && a.distanceM < b.distanceM);

const autoMerges = ({ score, distanceM }: Match) =>
  (distanceM <= SEEDING_MATCH.mergeMaxM && score >= SEEDING_MATCH.mergeMinScore) ||
  (distanceM <= SEEDING_MATCH.containedMaxM && score >= 0.9);

/**
 * Decides where each new (unassigned) row goes: onto an existing record, into an existing or
 * newly formed candidate, or into a new candidate of its own. A group never holds two rows of one
 * source; such pairs are left to merge review.
 */
export function assignRows(
  newRows: readonly PoolRow[],
  existing: { rows: readonly PoolRow[]; records: readonly RecordRef[] },
): Assignment {
  const records = new Grid<RecordRef>();
  for (const r of existing.records) records.add(r.location, r);

  const groups: Group[] = [];
  const byCandidate = new Map<string, Group>();
  const members = new Grid<{ row: PoolRow; group: Group }>();
  for (const row of existing.rows) {
    if (!row.candidateId) continue;
    let group = byCandidate.get(row.candidateId);
    if (!group) {
      group = { candidateId: row.candidateId, rowIds: [], sources: new Set() };
      byCandidate.set(row.candidateId, group);
    }
    group.sources.add(row.source);
    members.add(row.location, { row, group });
  }

  const out: Assignment = { toRecord: [], toCandidate: [], newCandidates: [] };
  for (const row of newRows) {
    let record: (Match & { id: string }) | null = null;
    for (const r of records.near(row.location)) {
      const m = {
        id: r.id,
        score: nameSimilarity(row.name, r.title),
        distanceM: haversineM(row.location, r.location),
      };
      if (
        m.distanceM <= SEEDING_MATCH.recordMaxM &&
        m.score >= SEEDING_MATCH.recordMinScore &&
        better(m, record)
      ) {
        record = m;
      }
    }
    if (record) {
      out.toRecord.push({ rowId: row.id, recordId: record.id });
      continue;
    }

    let target: (Match & { group: Group }) | null = null;
    for (const { row: other, group } of members.near(row.location)) {
      if (group.sources.has(row.source)) continue;
      const m = {
        group,
        score: nameSimilarity(row.name, other.name),
        distanceM: haversineM(row.location, other.location),
      };
      if (autoMerges(m) && better(m, target)) target = m;
    }
    const group = target?.group ?? { candidateId: null, rowIds: [], sources: new Set() };
    if (!target) groups.push(group);
    group.rowIds.push(row.id);
    group.sources.add(row.source);
    members.add(row.location, { row, group });
    if (group.candidateId) out.toCandidate.push({ rowId: row.id, candidateId: group.candidateId });
  }
  out.newCandidates = groups.map((g) => g.rowIds);
  return out;
}

/** The key of an unordered candidate pair, as `seeding_kept_apart` orders it (a < b). */
export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export interface PossibleDuplicate {
  otherId: string;
  distanceM: number;
  score: number;
}

/**
 * Candidate pairs that might be one place: their closest qualifying row pair is within
 * `possibleMaxM` with a middling name score, or very close with a weak one. Kept-apart pairs are
 * left out. Symmetric; each list sorted by distance.
 */
export function possibleDuplicates(
  candidates: readonly { id: string; rows: readonly { name: string; location: LatLng }[] }[],
  keptApart: ReadonlySet<string>,
): Map<string, PossibleDuplicate[]> {
  const grid = new Grid<{ candidateId: string; name: string; location: LatLng }>();
  for (const c of candidates)
    for (const r of c.rows) grid.add(r.location, { candidateId: c.id, ...r });

  const best = new Map<string, Match>();
  for (const c of candidates) {
    for (const r of c.rows) {
      for (const o of grid.near(r.location)) {
        if (o.candidateId <= c.id) continue;
        const key = pairKey(c.id, o.candidateId);
        if (keptApart.has(key)) continue;
        const m = {
          score: nameSimilarity(r.name, o.name),
          distanceM: haversineM(r.location, o.location),
        };
        const qualifies =
          (m.distanceM <= SEEDING_MATCH.possibleMaxM &&
            m.score >= SEEDING_MATCH.possibleMinScore) ||
          (m.distanceM <= SEEDING_MATCH.containedMaxM && m.score >= 0.3);
        const current = best.get(key);
        if (qualifies && (!current || m.distanceM < current.distanceM)) best.set(key, m);
      }
    }
  }

  const out = new Map<string, PossibleDuplicate[]>();
  const push = (id: string, d: PossibleDuplicate) => out.set(id, [...(out.get(id) ?? []), d]);
  for (const [key, m] of best) {
    const [a = '', b = ''] = key.split('|');
    push(a, { otherId: b, ...m });
    push(b, { otherId: a, ...m });
  }
  for (const list of out.values()) list.sort((x, y) => x.distanceM - y.distanceM);
  return out;
}

export interface ViewRow {
  source: SeedingSource;
  name: string;
  location: LatLng;
  placeCategory: PlaceCategory;
}

const rank = (order: readonly SeedingSource[], s: SeedingSource) => order.indexOf(s);
const pick = <T extends ViewRow>(rows: readonly T[], order: readonly SeedingSource[]): T => {
  const [first] = [...rows].sort((a, b) => rank(order, a.source) - rank(order, b.source));
  if (!first) throw new Error('candidate without rows');
  return first;
};

/** A candidate's shown name, location and category, by source precedence; rows sorted the same. */
export function candidateView<T extends ViewRow>(rows: readonly T[]) {
  return {
    name: pick(rows, NAME_PRECEDENCE).name,
    location: pick(rows, LOCATION_PRECEDENCE).location,
    placeCategory: pick(rows, CATEGORY_PRECEDENCE).placeCategory,
    sources: [...rows].sort(
      (a, b) => rank(NAME_PRECEDENCE, a.source) - rank(NAME_PRECEDENCE, b.source),
    ),
  };
}
