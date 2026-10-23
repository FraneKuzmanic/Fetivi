import { and, asc, count, desc, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { createCatalogRecord, markVerified, updateCatalogRecord } from '../catalog/store';
import {
  PLACE_CATEGORIES,
  type PlaceCategory,
  SOURCE_FIELDS,
  type SourceField,
} from '../catalog/vocabulary';
import type { Db, Executor } from '../db/client';
import { accounts } from '../db/schema/accounts';
import { catalogRecords, destinations } from '../db/schema/catalog';
import { type CurationItemRow, curationItems } from '../db/schema/curation';
import type { JobQueue } from '../jobs/queue';
import {
  CURATED_TEXT_FIELDS,
  CURATION_KIND_ACTIONS,
  CURATION_KINDS,
  CURATION_LIST_LIMIT,
  type CuratedChanges,
  type CurationKind,
  type CurationPayload,
  type CurationStatus,
  type CurationTab,
  isRecordKind,
  isReviewable,
  REVIEWABLE_STATUSES,
} from './vocabulary';

// The admin's review of the curation queue (39 AC 2). The queue has no assignees, so every
// status change is conditional on the item still being reviewable: of two admins acting on one
// item, the second gets `not-reviewable`.

export class CurationRuleError extends Error {
  override name = 'CurationRuleError';
  constructor(readonly code: 'not-found' | 'not-reviewable' | 'invalid-input') {
    super(code);
  }
}

export interface CurationFilter {
  status: CurationTab;
  kind?: CurationKind;
  destinationId?: string;
}

export interface CurationListItem {
  id: string;
  kind: CurationKind;
  status: CurationStatus;
  payload: CurationPayload;
  destination: { id: string; name: string } | null;
  host: { id: string; email: string } | null;
  record: {
    id: string;
    title: string;
    kind: string;
    placeCategory: PlaceCategory | null;
    verifiedAt: Date | null;
  } | null;
  createdAt: Date;
  reviewedAt: Date | null;
}

export interface ReviewDeps {
  db: Db;
  queue: JobQueue;
}

function statusWhere(status: CurationTab): SQL {
  return status === 'done'
    ? inArray(curationItems.status, ['approved', 'rejected'])
    : eq(curationItems.status, status);
}

const reviewable = () => inArray(curationItems.status, [...REVIEWABLE_STATUSES]);

/** Items with their record, destination and host, for the list and a single reload. */
async function selectItems(
  db: Executor,
  where: SQL | undefined,
  order: SQL[],
  limit: number,
): Promise<CurationListItem[]> {
  const host = alias(accounts, 'host');
  const rows = await db
    .select({
      item: curationItems,
      record: {
        id: catalogRecords.id,
        title: catalogRecords.title,
        kind: catalogRecords.kind,
        placeCategory: catalogRecords.placeCategory,
        verifiedAt: catalogRecords.verifiedAt,
      },
      destination: { id: destinations.id, name: destinations.name },
      host: { id: host.id, email: host.email },
    })
    .from(curationItems)
    .leftJoin(catalogRecords, eq(catalogRecords.id, curationItems.recordId))
    .leftJoin(destinations, eq(destinations.id, curationItems.destinationId))
    .leftJoin(host, eq(host.id, curationItems.hostId))
    .where(where)
    .orderBy(...order)
    .limit(limit);
  return rows.map(({ item, record, destination, host }) => ({
    id: item.id,
    kind: item.kind,
    status: item.status,
    payload: item.payload as CurationPayload,
    destination,
    host,
    record,
    createdAt: item.createdAt,
    reviewedAt: item.reviewedAt,
  }));
}

/** Open and needs-a-visit items oldest first; done items newest reviewed first. */
export function listCurationItems(
  db: Executor,
  filter: CurationFilter,
  limit = CURATION_LIST_LIMIT,
): Promise<CurationListItem[]> {
  const where = [statusWhere(filter.status)];
  if (filter.kind) where.push(eq(curationItems.kind, filter.kind));
  if (filter.destinationId) where.push(eq(curationItems.destinationId, filter.destinationId));
  return selectItems(
    db,
    and(...where),
    [
      filter.status === 'done' ? desc(curationItems.reviewedAt) : asc(curationItems.createdAt),
      asc(curationItems.id),
    ],
    limit,
  );
}

/** One item as the list shows it, or null. */
export async function getCurationItem(db: Executor, id: string): Promise<CurationListItem | null> {
  const [item] = await selectItems(db, eq(curationItems.id, id), [], 1);
  return item ?? null;
}

/** Items per kind for one status (and destination), zero-filled, for the filter badges. */
export async function countCurationItems(
  db: Executor,
  filter: Omit<CurationFilter, 'kind'>,
): Promise<Record<CurationKind, number>> {
  const where = [statusWhere(filter.status)];
  if (filter.destinationId) where.push(eq(curationItems.destinationId, filter.destinationId));
  const rows = await db
    .select({ kind: curationItems.kind, n: count() })
    .from(curationItems)
    .where(and(...where))
    .groupBy(curationItems.kind);
  const counts = Object.fromEntries(CURATION_KINDS.map((k) => [k, 0])) as Record<
    CurationKind,
    number
  >;
  for (const r of rows) counts[r.kind] = r.n;
  return counts;
}

async function loadReviewable(db: Executor, id: string): Promise<CurationItemRow> {
  const [item] = await db.select().from(curationItems).where(eq(curationItems.id, id));
  if (!item) throw new CurationRuleError('not-found');
  if (!isReviewable(item.status)) {
    throw new CurationRuleError('not-reviewable');
  }
  return item;
}

/** Writes a draft's or refresh diff's proposed fields into the record. */
async function applyChanges(
  { db, queue }: ReviewDeps,
  recordId: string,
  changes: CuratedChanges,
  now: Date,
): Promise<void> {
  const [record] = await db
    .select({ kind: catalogRecords.kind, fieldSources: catalogRecords.fieldSources })
    .from(catalogRecords)
    .where(eq(catalogRecords.id, recordId));
  if (!record) throw new CurationRuleError('not-found');
  const fields: Partial<Record<(typeof CURATED_TEXT_FIELDS)[number], string>> = {};
  for (const f of CURATED_TEXT_FIELDS) {
    const value = changes[f];
    if (value !== undefined) fields[f] = value;
  }
  // Only source URLs for fields this record's kind has.
  const allowed: readonly string[] = SOURCE_FIELDS[record.kind];
  const sources = Object.fromEntries(
    Object.entries(changes.fieldSources ?? {}).filter(
      ([field, url]) => allowed.includes(field) && typeof url === 'string',
    ),
  ) as Partial<Record<SourceField, string>>;
  await updateCatalogRecord(
    db,
    queue,
    recordId,
    {
      ...fields,
      fieldSources: { ...record.fieldSources, ...sources },
    },
    now,
  );
}

/** Creates the catalog place a host suggested, unverified, in the item's destination. */
async function createFromSuggestion(
  { db, queue }: ReviewDeps,
  item: CurationItemRow,
  payload: Extract<CurationPayload, { kind: 'host_place_suggestion' }>,
  now: Date,
): Promise<string> {
  const category = payload.placeCategory as PlaceCategory;
  if (!PLACE_CATEGORIES.includes(category) || item.destinationId === null) {
    throw new CurationRuleError('invalid-input');
  }
  const record = await createCatalogRecord(
    db,
    queue,
    {
      destinationId: item.destinationId,
      kind: 'place',
      title: payload.name,
      description: payload.note ?? '',
      placeCategory: category,
      location: { x: payload.location.lng, y: payload.location.lat },
      address: payload.address,
    },
    now,
  );
  return record.id;
}

/**
 * Applies what the item proposes, once: a draft's or diff's fields, or a suggested place's new
 * record. Returns the record id and whether this call applied anything.
 *
 * `createCatalogRecord`/`updateCatalogRecord` own their transactions (translation enqueueing
 * lives inside them), so this runs before the status update. A double approve can re-apply the
 * same values, which is harmless: the text is equal, so no new revision. `applied_at` stops a
 * second apply once the first status write committed, so an admin's later edits survive.
 */
async function applyOnce(
  deps: ReviewDeps,
  item: CurationItemRow,
  now: Date,
): Promise<{ recordId: string | null; applied: boolean }> {
  const payload = item.payload as CurationPayload;
  if (item.appliedAt !== null) return { recordId: item.recordId, applied: false };
  if (payload.kind === 'draft' || payload.kind === 'refresh_diff') {
    // A proposal with no record to write it into would be approved with no effect.
    if (item.recordId === null) throw new CurationRuleError('invalid-input');
    await applyChanges(deps, item.recordId, payload.changes, now);
    return { recordId: item.recordId, applied: true };
  }
  if (payload.kind === 'host_place_suggestion' && item.recordId === null) {
    return { recordId: await createFromSuggestion(deps, item, payload, now), applied: true };
  }
  return { recordId: item.recordId, applied: false };
}

/** Approves an item; on a record-bound kind it applies the proposal and verifies the record. */
export async function approveCurationItem(
  deps: ReviewDeps,
  id: string,
  adminId: string,
  now: Date,
): Promise<CurationItemRow> {
  const item = await loadReviewable(deps.db, id);
  const { recordId, applied } = await applyOnce(deps, item, now);
  return deps.db.transaction(async (tx) => {
    const [row] = await tx
      .update(curationItems)
      .set({
        status: 'approved',
        reviewedAt: now,
        reviewedBy: adminId,
        recordId,
        ...(applied
          ? {
              appliedAt: sql`coalesce(${curationItems.appliedAt}, ${now.toISOString()}::timestamptz)`,
            }
          : {}),
        updatedAt: now,
      })
      .where(and(eq(curationItems.id, id), reviewable()))
      .returning();
    if (!row) throw new CurationRuleError('not-reviewable');
    if (isRecordKind(row.kind) && row.recordId) {
      await markVerified(tx, row.recordId, adminId, now);
    }
    return row;
  });
}

/**
 * Prepares the record for the catalog editor: applies the proposal (or creates the suggested
 * place, unverified) and returns the record id. The item's status does not change.
 */
export async function editCurationItem(
  deps: ReviewDeps,
  id: string,
  now: Date,
): Promise<{ recordId: string }> {
  const item = await loadReviewable(deps.db, id);
  if (!CURATION_KIND_ACTIONS[item.kind].includes('edit')) {
    throw new CurationRuleError('invalid-input');
  }
  const { recordId, applied } = await applyOnce(deps, item, now);
  if (recordId === null) throw new CurationRuleError('invalid-input');
  if (applied) {
    const [row] = await deps.db
      .update(curationItems)
      .set({ recordId, appliedAt: now, updatedAt: now })
      .where(and(eq(curationItems.id, id), reviewable(), isNull(curationItems.appliedAt)))
      .returning({ recordId: curationItems.recordId });
    // A concurrent Edit or Approve applied first: open the record it recorded.
    if (!row) {
      const [current] = await deps.db
        .select({ recordId: curationItems.recordId })
        .from(curationItems)
        .where(eq(curationItems.id, id));
      if (!current) throw new CurationRuleError('not-found');
      return { recordId: current.recordId ?? recordId };
    }
  }
  return { recordId };
}

/** Moves a reviewable item to `status`; never touches the record. */
async function transition(
  db: Executor,
  id: string,
  status: 'rejected' | 'needs_visit',
  adminId: string,
  now: Date,
): Promise<void> {
  const [row] = await db
    .update(curationItems)
    .set({ status, reviewedAt: now, reviewedBy: adminId, updatedAt: now })
    .where(and(eq(curationItems.id, id), reviewable()))
    .returning({ id: curationItems.id });
  if (row) return;
  const [exists] = await db
    .select({ id: curationItems.id })
    .from(curationItems)
    .where(eq(curationItems.id, id));
  throw new CurationRuleError(exists ? 'not-reviewable' : 'not-found');
}

export function rejectCurationItem(db: Executor, id: string, adminId: string, now: Date) {
  return transition(db, id, 'rejected', adminId, now);
}

/** Parks the item until someone visits; it stays reviewable. */
export function markNeedsVisit(db: Executor, id: string, adminId: string, now: Date) {
  return transition(db, id, 'needs_visit', adminId, now);
}
