import { and, count, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { enqueueCurationItem } from '../../curation/store';
import type { CurationStatus } from '../../curation/vocabulary';
import type { Db, Executor } from '../../db/client';
import { catalogRecords, destinations, placeOpenDataSources } from '../../db/schema/catalog';
import { curationItems } from '../../db/schema/curation';
import {
  type SeedingImportRow,
  seedingCandidates,
  seedingImports,
  seedingKeptApart,
} from '../../db/schema/seeding';
import type { PlaceCategory } from '../vocabulary';
import {
  assignRows,
  candidateName,
  candidateView,
  type PoolRow,
  pairKey,
  possibleDuplicates,
} from './dedupe';
import { SeedingRuleError } from './errors';
import { haversineM, type LatLng } from './geo';
import type { ImportedRow } from './types';
import {
  SEEDING_CANDIDATE_STATUSES,
  SEEDING_LIMITS,
  type SeedingCandidateStatus,
  type SeedingSource,
} from './vocabulary';

// Seeding's database side. Writes only place_open_data_sources and the seeding tables, plus the
// draft Curation items; never a catalog_records column (AC 3).

const toPoint = (p: LatLng) => ({ x: p.lng, y: p.lat });
const fromPoint = (p: { x: number; y: number }): LatLng => ({ lat: p.y, lng: p.x });

/** The draft item's dedupe key: one draft per candidate, however often it is ticked. */
export const candidateDraftKey = (candidateId: string) => `seeding-candidate:${candidateId}`;

const UPSERT_CHUNK = 500;

/**
 * Inserts or refreshes a destination's source rows by (source, externalId). Returns the ids of
 * rows that are unassigned afterwards: new rows, and rows whose candidate or record was deleted.
 */
export async function upsertSourceRows(
  db: Executor,
  destinationId: string,
  rows: readonly ImportedRow[],
  now: Date,
): Promise<{ unassigned: string[] }> {
  const unique = [...new Map(rows.map((r) => [`${r.source}|${r.externalId}`, r])).values()];
  const unassigned: string[] = [];
  for (let i = 0; i < unique.length; i += UPSERT_CHUNK) {
    const values = unique.slice(i, i + UPSERT_CHUNK).map((r) => ({
      destinationId,
      source: r.source,
      externalId: r.externalId,
      licence: r.licence,
      name: r.name,
      location: toPoint(r.location),
      placeCategory: r.placeCategory,
      sourceUrl: r.sourceUrl,
      data: r.data,
      fetchedAt: now,
      createdAt: now,
      updatedAt: now,
    }));
    const written = await db
      .insert(placeOpenDataSources)
      .values(values)
      .onConflictDoUpdate({
        target: [
          placeOpenDataSources.destinationId,
          placeOpenDataSources.source,
          placeOpenDataSources.externalId,
        ],
        set: {
          name: sql`excluded.name`,
          location: sql`excluded.location`,
          placeCategory: sql`excluded.place_category`,
          licence: sql`excluded.licence`,
          sourceUrl: sql`excluded.source_url`,
          data: sql`excluded.data`,
          fetchedAt: now,
          updatedAt: now,
        },
      })
      .returning({
        id: placeOpenDataSources.id,
        candidateId: placeOpenDataSources.candidateId,
        recordId: placeOpenDataSources.recordId,
      });
    for (const w of written) if (!w.candidateId && !w.recordId) unassigned.push(w.id);
  }
  return { unassigned };
}

/**
 * Groups the destination's unassigned rows: onto a matching place record, into a matching
 * candidate (dismissed ones too, so a dismissed place is not proposed again), or into new
 * candidates.
 */
export async function groupUnassigned(
  db: Db,
  destinationId: string,
  now: Date,
): Promise<{ attached: number; joined: number; created: number }> {
  return db.transaction(async (tx) => {
    const pool = await tx
      .select({
        id: placeOpenDataSources.id,
        source: placeOpenDataSources.source,
        name: placeOpenDataSources.name,
        location: placeOpenDataSources.location,
        candidateId: placeOpenDataSources.candidateId,
        recordId: placeOpenDataSources.recordId,
      })
      .from(placeOpenDataSources)
      .where(eq(placeOpenDataSources.destinationId, destinationId));
    const rows: PoolRow[] = pool.map((r) => ({
      ...r,
      source: r.source as SeedingSource,
      location: fromPoint(r.location),
    }));
    const fresh = rows.filter((r) => !r.candidateId && !r.recordId);
    if (fresh.length === 0) return { attached: 0, joined: 0, created: 0 };

    const records = await tx
      .select({
        id: catalogRecords.id,
        title: catalogRecords.title,
        location: catalogRecords.location,
      })
      .from(catalogRecords)
      .where(
        and(
          eq(catalogRecords.destinationId, destinationId),
          eq(catalogRecords.kind, 'place'),
          isNotNull(catalogRecords.location),
        ),
      );
    const result = assignRows(fresh, {
      rows: rows.filter((r) => r.candidateId),
      records: records.flatMap((r) =>
        r.location ? [{ id: r.id, title: r.title, location: fromPoint(r.location) }] : [],
      ),
    });

    for (const { rowId, recordId } of result.toRecord) {
      await tx
        .update(placeOpenDataSources)
        .set({ recordId, updatedAt: now })
        .where(eq(placeOpenDataSources.id, rowId));
    }
    for (const { rowId, candidateId } of result.toCandidate) {
      await tx
        .update(placeOpenDataSources)
        .set({ candidateId, updatedAt: now })
        .where(eq(placeOpenDataSources.id, rowId));
    }
    if (result.newCandidates.length > 0) {
      const created = await tx
        .insert(seedingCandidates)
        .values(result.newCandidates.map(() => ({ destinationId, createdAt: now, updatedAt: now })))
        .returning({ id: seedingCandidates.id });
      for (const [i, group] of result.newCandidates.entries()) {
        const candidate = created[i];
        if (!candidate) throw new Error('candidate not inserted');
        await tx
          .update(placeOpenDataSources)
          .set({ candidateId: candidate.id, updatedAt: now })
          .where(inArray(placeOpenDataSources.id, group));
      }
    }
    return {
      attached: result.toRecord.length,
      joined: result.toCandidate.length,
      created: result.newCandidates.length,
    };
  });
}

export interface SeedingSourceView {
  id: string;
  source: SeedingSource;
  externalId: string;
  name: string;
  licence: string;
  sourceUrl: string | null;
}

export interface SeedingCandidateView {
  id: string;
  status: SeedingCandidateStatus;
  name: string;
  placeCategory: PlaceCategory;
  location: LatLng;
  distanceM: number;
  sources: SeedingSourceView[];
  draft: { itemId: string; status: CurationStatus } | null;
  possibleDuplicates: { id: string; name: string; distanceM: number; score: number }[];
}

export interface SeedingOverview {
  destination: { id: string; name: string; radiusM: number };
  lastImport: SeedingImportRow | null;
  counts: Record<SeedingCandidateStatus, number>;
  /** Distinct catalog records open-data rows were attached to. */
  matchedRecords: number;
  candidates: SeedingCandidateView[];
}

/** One tab of the Seeding screen; possible duplicates are computed over new and ticked. */
export async function listCandidates(
  db: Executor,
  destinationId: string,
  status: SeedingCandidateStatus,
): Promise<SeedingOverview> {
  const [destination] = await db
    .select()
    .from(destinations)
    .where(eq(destinations.id, destinationId));
  if (!destination) throw new SeedingRuleError('not-found');
  const centre = fromPoint(destination.centre);

  const statuses = [...new Set<SeedingCandidateStatus>(['new', 'ticked', status])];
  const joined = await db
    .select({
      candidateId: seedingCandidates.id,
      status: seedingCandidates.status,
      rowId: placeOpenDataSources.id,
      source: placeOpenDataSources.source,
      externalId: placeOpenDataSources.externalId,
      name: placeOpenDataSources.name,
      licence: placeOpenDataSources.licence,
      sourceUrl: placeOpenDataSources.sourceUrl,
      location: placeOpenDataSources.location,
      placeCategory: placeOpenDataSources.placeCategory,
    })
    .from(seedingCandidates)
    .innerJoin(placeOpenDataSources, eq(placeOpenDataSources.candidateId, seedingCandidates.id))
    .where(
      and(
        eq(seedingCandidates.destinationId, destinationId),
        inArray(seedingCandidates.status, statuses),
      ),
    );

  const byCandidate = new Map<
    string,
    {
      status: SeedingCandidateStatus;
      rows: (SeedingSourceView & { location: LatLng; placeCategory: PlaceCategory })[];
    }
  >();
  for (const r of joined) {
    const entry = byCandidate.get(r.candidateId) ?? { status: r.status, rows: [] };
    entry.rows.push({
      id: r.rowId,
      source: r.source as SeedingSource,
      externalId: r.externalId,
      name: r.name,
      licence: r.licence,
      sourceUrl: r.sourceUrl,
      location: fromPoint(r.location),
      placeCategory: r.placeCategory,
    });
    byCandidate.set(r.candidateId, entry);
  }
  const views = new Map([...byCandidate].map(([id, c]) => [id, candidateView(c.rows)]));

  const kept = await db
    .select({ a: seedingKeptApart.candidateA, b: seedingKeptApart.candidateB })
    .from(seedingKeptApart)
    .innerJoin(seedingCandidates, eq(seedingCandidates.id, seedingKeptApart.candidateA))
    .where(eq(seedingCandidates.destinationId, destinationId));
  const reviewable = [...byCandidate].filter(([, c]) => c.status !== 'dismissed');
  const dupes = possibleDuplicates(
    reviewable.map(([id, c]) => ({ id, rows: c.rows })),
    new Set(kept.map((k) => pairKey(k.a, k.b))),
  );

  const listed = [...byCandidate]
    .filter(([, c]) => c.status === status)
    .map(([id]) => id)
    .sort((a, b) => (views.get(a)?.name ?? '').localeCompare(views.get(b)?.name ?? ''))
    .slice(0, SEEDING_LIMITS.candidatesPerList);

  const drafts =
    listed.length === 0
      ? []
      : await db
          .select({
            id: curationItems.id,
            status: curationItems.status,
            dedupeKey: curationItems.dedupeKey,
          })
          .from(curationItems)
          .where(inArray(curationItems.dedupeKey, listed.map(candidateDraftKey)));
  const draftByKey = new Map(drafts.map((d) => [d.dedupeKey, d]));

  const candidates = listed.map((id): SeedingCandidateView => {
    const view = views.get(id);
    const entry = byCandidate.get(id);
    if (!view || !entry) throw new Error('candidate view missing');
    const draft = draftByKey.get(candidateDraftKey(id));
    return {
      id,
      status: entry.status,
      name: view.name,
      placeCategory: view.placeCategory,
      location: view.location,
      distanceM: Math.round(haversineM(view.location, centre)),
      sources: view.sources.map(({ location: _l, placeCategory: _c, ...s }) => s),
      draft: draft ? { itemId: draft.id, status: draft.status } : null,
      possibleDuplicates: (dupes.get(id) ?? []).map((d) => ({
        id: d.otherId,
        name: views.get(d.otherId)?.name ?? '',
        distanceM: Math.round(d.distanceM),
        score: d.score,
      })),
    };
  });

  const countRows = await db
    .select({ status: seedingCandidates.status, n: count() })
    .from(seedingCandidates)
    .where(eq(seedingCandidates.destinationId, destinationId))
    .groupBy(seedingCandidates.status);
  const counts = Object.fromEntries(SEEDING_CANDIDATE_STATUSES.map((s) => [s, 0])) as Record<
    SeedingCandidateStatus,
    number
  >;
  for (const c of countRows) counts[c.status] = c.n;

  const [matched] = await db
    .select({ n: sql<number>`count(distinct ${placeOpenDataSources.recordId})::int` })
    .from(placeOpenDataSources)
    .where(eq(placeOpenDataSources.destinationId, destinationId));
  const [lastImport] = await db
    .select()
    .from(seedingImports)
    .where(eq(seedingImports.destinationId, destinationId))
    .orderBy(desc(seedingImports.startedAt))
    .limit(1);

  return {
    destination: { id: destination.id, name: destination.name, radiusM: destination.radiusM },
    lastImport: lastImport ?? null,
    counts,
    matchedRecords: matched?.n ?? 0,
    candidates,
  };
}

/**
 * Ticks candidates and puts one open `draft` Curation item on the queue for each, with no record
 * (ADR 0019): ticket 42's drafting job fills it. Ticking a ticked candidate adds nothing.
 */
export async function draftCandidates(
  db: Db,
  destinationId: string,
  candidateIds: readonly string[],
  adminId: string,
  now: Date,
): Promise<{ drafted: number }> {
  const ids = [...new Set(candidateIds)];
  if (ids.length === 0 || ids.length > SEEDING_LIMITS.draftPerRequest) {
    throw new SeedingRuleError('invalid-input');
  }
  return db.transaction(async (tx) => {
    const locked = await tx
      .select({ id: seedingCandidates.id, status: seedingCandidates.status })
      .from(seedingCandidates)
      .where(
        and(inArray(seedingCandidates.id, ids), eq(seedingCandidates.destinationId, destinationId)),
      )
      .for('update');
    if (locked.length !== ids.length) throw new SeedingRuleError('not-found');
    if (locked.some((c) => c.status === 'dismissed')) throw new SeedingRuleError('invalid-state');
    const fresh = locked.filter((c) => c.status === 'new').map((c) => c.id);
    if (fresh.length > 0) {
      await tx
        .update(seedingCandidates)
        .set({ status: 'ticked', tickedAt: now, tickedBy: adminId, updatedAt: now })
        .where(inArray(seedingCandidates.id, fresh));
    }
    let drafted = 0;
    for (const id of ids) {
      const { created } = await enqueueCurationItem(
        tx,
        {
          destinationId,
          recordId: null,
          dedupeKey: candidateDraftKey(id),
          payload: { kind: 'draft', changes: {}, candidateId: id },
        },
        now,
      );
      if (created) drafted++;
    }
    return { drafted };
  });
}

async function move(
  db: Executor,
  id: string,
  from: SeedingCandidateStatus,
  to: SeedingCandidateStatus,
  now: Date,
): Promise<void> {
  const [row] = await db
    .update(seedingCandidates)
    .set({ status: to, updatedAt: now })
    .where(and(eq(seedingCandidates.id, id), eq(seedingCandidates.status, from)))
    .returning({ id: seedingCandidates.id });
  if (row) return;
  const [exists] = await db
    .select({ id: seedingCandidates.id })
    .from(seedingCandidates)
    .where(eq(seedingCandidates.id, id));
  throw new SeedingRuleError(exists ? 'invalid-state' : 'not-found');
}

/** Takes a new candidate off the New list. */
export const dismissCandidate = (db: Executor, id: string, now: Date) =>
  move(db, id, 'new', 'dismissed', now);

/** Puts a dismissed candidate back on the New list. */
export const restoreCandidate = (db: Executor, id: string, now: Date) =>
  move(db, id, 'dismissed', 'new', now);

async function lockPair(tx: Executor, aId: string, bId: string) {
  if (aId === bId) throw new SeedingRuleError('invalid-input');
  const rows = await tx
    .select()
    .from(seedingCandidates)
    .where(inArray(seedingCandidates.id, [aId, bId]))
    .for('update');
  const a = rows.find((r) => r.id === aId);
  const b = rows.find((r) => r.id === bId);
  if (!a || !b) throw new SeedingRuleError('not-found');
  if (a.destinationId !== b.destinationId) throw new SeedingRuleError('invalid-input');
  return [a, b] as const;
}

/**
 * Merges two candidates the admin says are one place: all rows move to the survivor, the other
 * is deleted. A ticked candidate always survives, so its draft item keeps its candidate.
 */
export async function mergeCandidates(
  db: Db,
  sourceId: string,
  targetId: string,
  now: Date,
): Promise<{ candidateId: string }> {
  return db.transaction(async (tx) => {
    const [a, b] = await lockPair(tx, sourceId, targetId);
    if (a.status === 'dismissed' || b.status === 'dismissed') {
      throw new SeedingRuleError('invalid-state');
    }
    if (a.status === 'ticked' && b.status === 'ticked') throw new SeedingRuleError('invalid-state');
    const [from, into] = a.status === 'ticked' ? [b, a] : [a, b];
    await tx
      .update(placeOpenDataSources)
      .set({ candidateId: into.id, updatedAt: now })
      .where(eq(placeOpenDataSources.candidateId, from.id));
    await tx.delete(seedingCandidates).where(eq(seedingCandidates.id, from.id));
    await tx
      .update(seedingCandidates)
      .set({ updatedAt: now })
      .where(eq(seedingCandidates.id, into.id));
    return { candidateId: into.id };
  });
}

async function insertKeptApart(
  tx: Executor,
  aId: string,
  bId: string,
  adminId: string | null,
  now: Date,
) {
  const [candidateA, candidateB] = aId < bId ? [aId, bId] : [bId, aId];
  await tx
    .insert(seedingKeptApart)
    .values({ candidateA, candidateB, decidedBy: adminId, createdAt: now })
    .onConflictDoNothing();
}

/** Undoes an auto-merge: one source row of a new candidate becomes a candidate of its own. */
export async function splitSourceRow(
  db: Db,
  rowId: string,
  adminId: string,
  now: Date,
): Promise<{ candidateId: string }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ candidateId: placeOpenDataSources.candidateId })
      .from(placeOpenDataSources)
      .where(eq(placeOpenDataSources.id, rowId));
    if (!row) throw new SeedingRuleError('not-found');
    if (!row.candidateId) throw new SeedingRuleError('invalid-state');
    const [candidate] = await tx
      .select()
      .from(seedingCandidates)
      .where(eq(seedingCandidates.id, row.candidateId))
      .for('update');
    if (candidate?.status !== 'new') throw new SeedingRuleError('invalid-state');
    const [siblings] = await tx
      .select({ n: count() })
      .from(placeOpenDataSources)
      .where(eq(placeOpenDataSources.candidateId, candidate.id));
    if ((siblings?.n ?? 0) < 2) throw new SeedingRuleError('invalid-state');

    const [split] = await tx
      .insert(seedingCandidates)
      .values({ destinationId: candidate.destinationId, createdAt: now, updatedAt: now })
      .returning({ id: seedingCandidates.id });
    if (!split) throw new Error('candidate not inserted');
    await tx
      .update(placeOpenDataSources)
      .set({ candidateId: split.id, updatedAt: now })
      .where(eq(placeOpenDataSources.id, rowId));
    await insertKeptApart(tx, candidate.id, split.id, adminId, now);
    return { candidateId: split.id };
  });
}

/** Records that two candidates are different places, so they are not offered for merge again. */
export async function keepApart(
  db: Db,
  aId: string,
  bId: string,
  adminId: string,
  now: Date,
): Promise<void> {
  await db.transaction(async (tx) => {
    await lockPair(tx, aId, bId);
    await insertKeptApart(tx, aId, bId, adminId, now);
  });
}

/** Each candidate's shown name (by source precedence), for the curation queue's headlines. */
export async function candidateNames(
  db: Executor,
  ids: readonly string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      candidateId: placeOpenDataSources.candidateId,
      source: placeOpenDataSources.source,
      name: placeOpenDataSources.name,
    })
    .from(placeOpenDataSources)
    .where(inArray(placeOpenDataSources.candidateId, [...new Set(ids)]));
  const byCandidate = new Map<string, { source: SeedingSource; name: string }[]>();
  for (const r of rows) {
    if (!r.candidateId) continue;
    const list = byCandidate.get(r.candidateId) ?? [];
    list.push({ source: r.source as SeedingSource, name: r.name });
    byCandidate.set(r.candidateId, list);
  }
  return new Map([...byCandidate].map(([id, list]) => [id, candidateName(list)]));
}
