import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { Executor } from '../db/client';
import { catalogRecords } from '../db/schema/catalog';
import { savedPlaces } from '../db/schema/saved-places';
import { loadSituation } from '../situation/load';

/** The ids of the places a Space saved, newest first. */
export async function listSavedPlaceIds(db: Executor, spaceId: string): Promise<string[]> {
  const rows = await db
    .select({ recordId: savedPlaces.recordId })
    .from(savedPlaces)
    .where(eq(savedPlaces.spaceId, spaceId))
    .orderBy(desc(savedPlaces.createdAt), savedPlaces.recordId);
  return rows.map((r) => r.recordId);
}

/**
 * Saves a place for the Space. Only what the guest could find: a published place or day trip in
 * the Space's destination (the visibility rule of the catalog's `visibleIn`). Saving twice is a no-op.
 */
export async function savePlace(
  db: Executor,
  spaceId: string,
  recordId: string,
  now: Date,
): Promise<'saved' | 'not-visible'> {
  const ctx = await loadSituation(db, spaceId, now);
  if (!ctx || ctx.destinationId === null) return 'not-visible';
  const [record] = await db
    .select({ id: catalogRecords.id })
    .from(catalogRecords)
    .where(
      and(
        eq(catalogRecords.id, recordId),
        eq(catalogRecords.destinationId, ctx.destinationId),
        isNotNull(catalogRecords.publishedRevision),
        inArray(catalogRecords.kind, ['place', 'day_trip']),
      ),
    );
  if (!record) return 'not-visible';
  await db.insert(savedPlaces).values({ spaceId, recordId, createdAt: now }).onConflictDoNothing();
  return 'saved';
}

/** Removes a saved place; removing one that is not saved is a no-op. */
export async function unsavePlace(db: Executor, spaceId: string, recordId: string): Promise<void> {
  await db
    .delete(savedPlaces)
    .where(and(eq(savedPlaces.spaceId, spaceId), eq(savedPlaces.recordId, recordId)));
}
