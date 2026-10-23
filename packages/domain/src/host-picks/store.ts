import { and, asc, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { findDestinationAt } from '../catalog/destination';
import type { CatalogKind, PlaceCategory } from '../catalog/vocabulary';
import { enqueueCurationItem } from '../curation/store';
import { type Db, type Executor, pgCode } from '../db/client';
import { catalogRecords, type DestinationRow, destinations } from '../db/schema/catalog';
import { type HostPlaceRow, hostPlaces, hostPlaceTranslations } from '../db/schema/host-places';
import { properties } from '../db/schema/properties';
import type { JobQueue } from '../jobs/queue';
import type { TranslationError, TranslationStatus } from '../property/vocabulary';
import { enqueueHostPlaceTranslation, lockHostPlaceRow, needsTranslation } from './translation';
import { HOST_PLACE_LIMITS } from './vocabulary';

// The host's write side of host places (40). Every function takes a property id the caller has
// already resolved as the host's own. Nothing here writes catalog_records: hosts never edit the
// catalog (AC 5). A new revision of the name or note enqueues its translation in the same
// transaction, as for Offers; a pick without a note has no text and is published at once.

export class HostPlaceRuleError extends Error {
  override name = 'HostPlaceRuleError';
  constructor(
    readonly code:
      | 'not-found'
      | 'invalid-input'
      | 'already-picked'
      | 'no-destination'
      | 'outside-destination'
      | 'limit-reached',
  ) {
    super(code);
  }
}

interface TranslationState {
  status: TranslationStatus;
  error: TranslationError | null;
}

export interface HostPickView {
  id: string;
  recordId: string;
  /** The catalog record's source title. */
  title: string;
  kind: 'place' | 'day_trip';
  placeCategory: PlaceCategory | null;
  note: string | null;
  translation: TranslationState;
}

export interface HostAddedView {
  id: string;
  name: string;
  placeCategory: PlaceCategory;
  location: { lat: number; lng: number };
  address: string | null;
  note: string;
  /** The admin approved its suggestion: it is (or will be, once published) a catalog record. */
  inCatalog: boolean;
  translation: TranslationState;
}

export interface HostPlaces {
  destination: { id: string; name: string } | null;
  picks: HostPickView[];
  added: HostAddedView[];
}

export interface CatalogPlaceOption {
  id: string;
  title: string;
  kind: 'place' | 'day_trip';
  placeCategory: PlaceCategory | null;
  address: string | null;
  picked: boolean;
}

export interface NewHostPick {
  recordId: string;
  note: string | null;
}

export interface NewHostAddedPlace {
  name: string;
  placeCategory: PlaceCategory;
  location: { lat: number; lng: number };
  address: string | null;
  note: string;
}

/** On a pick only `note` may change. */
export type HostPlaceChanges = Partial<{
  note: string | null;
  name: string;
  placeCategory: PlaceCategory;
  location: { lat: number; lng: number };
  address: string | null;
}>;

const PLACE_KINDS: CatalogKind[] = ['place', 'day_trip'];

/** A violated CHECK (23514) is invalid input; a second pick of a record (23505) is already-picked. */
async function checked<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const code = pgCode(error);
    if (code === '23514') throw new HostPlaceRuleError('invalid-input');
    if (code === '23505') throw new HostPlaceRuleError('already-picked');
    throw error;
  }
}

const translationOf = (r: HostPlaceRow): TranslationState => ({
  status: r.translationStatus,
  error: r.translationError,
});

/** The destination the property's guests are in (as the guest side finds it), or null. */
export async function propertyDestination(
  db: Executor,
  propertyId: string,
): Promise<DestinationRow | null> {
  const [property] = await db
    .select({ location: properties.location })
    .from(properties)
    .where(eq(properties.id, propertyId));
  if (!property?.location) return null;
  // wgs84Point is { x: lng, y: lat }.
  return findDestinationAt(db, { lat: property.location.y, lng: property.location.x });
}

async function requireDestination(db: Executor, propertyId: string): Promise<DestinationRow> {
  const destination = await propertyDestination(db, propertyId);
  if (!destination) throw new HostPlaceRuleError('no-destination');
  return destination;
}

/** The host place's property, if `hostId` owns it; the route's ownership check. */
export async function findOwnedHostPlace(
  db: Executor,
  hostId: string,
  id: string,
): Promise<{ id: string; propertyId: string } | null> {
  const [row] = await db
    .select({ id: hostPlaces.id, propertyId: hostPlaces.propertyId })
    .from(hostPlaces)
    .innerJoin(properties, eq(properties.id, hostPlaces.propertyId))
    .where(and(eq(hostPlaces.id, id), eq(properties.hostId, hostId)));
  return row ?? null;
}

/** The property's picks (as created) and added places, in the order they were added. */
export async function listHostPlaces(db: Executor, propertyId: string): Promise<HostPlaces> {
  const destination = await propertyDestination(db, propertyId);
  const rows = await db
    .select({
      row: hostPlaces,
      title: catalogRecords.title,
      kind: catalogRecords.kind,
      recordCategory: catalogRecords.placeCategory,
    })
    .from(hostPlaces)
    .leftJoin(catalogRecords, eq(catalogRecords.id, hostPlaces.catalogRecordId))
    .where(eq(hostPlaces.propertyId, propertyId))
    .orderBy(asc(hostPlaces.createdAt), asc(hostPlaces.id));
  const picks: HostPickView[] = [];
  const added: HostAddedView[] = [];
  for (const { row, title, kind, recordCategory } of rows) {
    if (row.name === null) {
      // The shape CHECK makes a nameless row a pick of an existing record.
      picks.push({
        id: row.id,
        recordId: row.catalogRecordId as string,
        title: title ?? '',
        kind: kind === 'day_trip' ? 'day_trip' : 'place',
        placeCategory: recordCategory,
        note: row.note,
        translation: translationOf(row),
      });
    } else {
      // The shape CHECK makes a named row carry its category, location and note.
      const location = row.location as { x: number; y: number };
      added.push({
        id: row.id,
        name: row.name,
        placeCategory: row.placeCategory as PlaceCategory,
        location: { lat: location.y, lng: location.x },
        address: row.address,
        note: row.note as string,
        inCatalog: row.catalogRecordId !== null,
        translation: translationOf(row),
      });
    }
  }
  return {
    destination: destination ? { id: destination.id, name: destination.name } : null,
    picks,
    added,
  };
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Published places and day trips in the property's destination, for the host to pick from. */
export async function browseCatalogPlaces(
  db: Executor,
  propertyId: string,
  query?: string,
): Promise<CatalogPlaceOption[]> {
  const destination = await requireDestination(db, propertyId);
  const q = query?.trim();
  const rows = await db
    .select({
      id: catalogRecords.id,
      title: catalogRecords.title,
      kind: catalogRecords.kind,
      placeCategory: catalogRecords.placeCategory,
      address: catalogRecords.address,
      picked: sql<boolean>`exists (select 1 from host_places h
          where h.property_id = ${propertyId} and h.catalog_record_id = "catalog_records"."id")`,
    })
    .from(catalogRecords)
    .where(
      and(
        eq(catalogRecords.destinationId, destination.id),
        isNotNull(catalogRecords.publishedRevision),
        inArray(catalogRecords.kind, PLACE_KINDS),
        q ? sql`${catalogRecords.title} ilike ${`%${escapeLike(q)}%`}` : undefined,
      ),
    )
    .orderBy(asc(catalogRecords.title), asc(catalogRecords.id))
    .limit(20);
  return rows.map((r) => ({ ...r, kind: r.kind === 'day_trip' ? 'day_trip' : 'place' }));
}

/** Locks the property row, which serialises the per-property limit, and checks it. */
async function lockForAdd(tx: Executor, propertyId: string) {
  const [property] = await tx
    .select({ id: properties.id, hostId: properties.hostId })
    .from(properties)
    .where(eq(properties.id, propertyId))
    .for('update');
  if (!property) throw new HostPlaceRuleError('not-found');
  const [count] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(hostPlaces)
    .where(eq(hostPlaces.propertyId, propertyId));
  if ((count?.n ?? 0) >= HOST_PLACE_LIMITS.perProperty) {
    throw new HostPlaceRuleError('limit-reached');
  }
  return property;
}

/** Enqueues the row's translation, or publishes it at once when it has no text. */
async function translateOrPublish(tx: Executor, queue: JobQueue, row: HostPlaceRow, now: Date) {
  if (needsTranslation(row)) {
    await enqueueHostPlaceTranslation(tx, queue, row);
    return row;
  }
  const [published] = await tx
    .update(hostPlaces)
    .set({
      publishedRevision: row.revision,
      translationStatus: 'published',
      translationError: null,
      updatedAt: now,
    })
    .where(eq(hostPlaces.id, row.id))
    .returning();
  await tx
    .delete(hostPlaceTranslations)
    .where(
      and(
        eq(hostPlaceTranslations.hostPlaceId, row.id),
        lt(hostPlaceTranslations.revision, row.revision),
      ),
    );
  return published ?? row;
}

/** Picks a published place or day trip of the property's destination, with an optional note. */
export async function createHostPick(
  db: Db,
  queue: JobQueue,
  propertyId: string,
  input: NewHostPick,
  now: Date,
): Promise<HostPlaceRow> {
  return checked(() =>
    db.transaction(async (tx) => {
      const destination = await requireDestination(tx, propertyId);
      const [record] = await tx
        .select({ id: catalogRecords.id })
        .from(catalogRecords)
        .where(
          and(
            eq(catalogRecords.id, input.recordId),
            eq(catalogRecords.destinationId, destination.id),
            isNotNull(catalogRecords.publishedRevision),
            inArray(catalogRecords.kind, PLACE_KINDS),
          ),
        );
      if (!record) throw new HostPlaceRuleError('invalid-input');
      await lockForAdd(tx, propertyId);
      const [row] = await tx
        .insert(hostPlaces)
        .values({
          propertyId,
          catalogRecordId: record.id,
          note: input.note,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!row) throw new Error('host place insert returned nothing');
      return translateOrPublish(tx, queue, row, now);
    }),
  );
}

async function requireInside(
  tx: Executor,
  destination: DestinationRow,
  at: NewHostAddedPlace['location'],
) {
  // Within the property's destination, as the guest read checks it: destinations may overlap, so
  // the nearest destination to the spot need not be the property's.
  const p = sql`ST_SetSRID(ST_MakePoint(${at.lng}::float8, ${at.lat}::float8), 4326)::geography`;
  const [inside] = await tx
    .select({ id: destinations.id })
    .from(destinations)
    .where(
      and(
        eq(destinations.id, destination.id),
        sql`ST_DWithin(${destinations.centre}::geography, ${p}, ${destinations.radiusM})`,
      ),
    );
  if (!inside) throw new HostPlaceRuleError('outside-destination');
}

/**
 * Adds a place that is not in the catalog. Its translation and its host place suggestion on the
 * curation queue are enqueued in the same transaction, so a failure leaves no orphan item.
 */
export async function createHostAddedPlace(
  db: Db,
  queue: JobQueue,
  propertyId: string,
  input: NewHostAddedPlace,
  now: Date,
): Promise<HostPlaceRow> {
  return checked(() =>
    db.transaction(async (tx) => {
      const destination = await requireDestination(tx, propertyId);
      await requireInside(tx, destination, input.location);
      const property = await lockForAdd(tx, propertyId);
      const [row] = await tx
        .insert(hostPlaces)
        .values({
          propertyId,
          name: input.name,
          placeCategory: input.placeCategory,
          location: { x: input.location.lng, y: input.location.lat },
          address: input.address,
          note: input.note,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!row) throw new Error('host place insert returned nothing');
      await enqueueHostPlaceTranslation(tx, queue, row);
      await enqueueCurationItem(
        tx,
        {
          hostId: property.hostId,
          destinationId: destination.id,
          dedupeKey: `host-place:${row.id}`,
          payload: {
            kind: 'host_place_suggestion',
            name: input.name,
            placeCategory: input.placeCategory,
            location: input.location,
            address: input.address,
            note: input.note,
            hostPlaceId: row.id,
          },
        },
        now,
      );
      return row;
    }),
  );
}

/**
 * Edits a host place. On a pick only the note changes; on a host-added place the name, category,
 * location, address and note do. A changed name or note adds a revision and re-translates it.
 * The open curation item is a snapshot and stays as suggested.
 */
export async function updateHostPlace(
  db: Db,
  queue: JobQueue,
  propertyId: string,
  id: string,
  changes: HostPlaceChanges,
  now: Date,
): Promise<HostPlaceRow> {
  return checked(() =>
    db.transaction(async (tx) => {
      const current = await lockHostPlaceRow(tx, id);
      if (!current || current.propertyId !== propertyId) {
        throw new HostPlaceRuleError('not-found');
      }
      const { note, location, ...placeFields } = changes;
      const placeChanged =
        location !== undefined || Object.values(placeFields).some((v) => v !== undefined);
      if (current.name === null && placeChanged) {
        throw new HostPlaceRuleError('invalid-input');
      }
      if (location !== undefined) {
        await requireInside(tx, await requireDestination(tx, propertyId), location);
      }
      const textChanged =
        (changes.name !== undefined && changes.name !== current.name) ||
        (note !== undefined && note !== current.note);
      const [row] = await tx
        .update(hostPlaces)
        .set({
          ...placeFields,
          ...(note !== undefined ? { note } : {}),
          ...(location !== undefined ? { location: { x: location.lng, y: location.lat } } : {}),
          updatedAt: now,
          ...(textChanged
            ? {
                revision: current.revision + 1,
                translationStatus: 'pending' as const,
                translationError: null,
              }
            : {}),
        })
        .where(eq(hostPlaces.id, id))
        .returning();
      if (!row) throw new HostPlaceRuleError('not-found');
      return textChanged ? translateOrPublish(tx, queue, row, now) : row;
    }),
  );
}

/** Removes a host place; its open curation item stays (approve then creates an unlinked record). */
export async function deleteHostPlace(db: Executor, propertyId: string, id: string): Promise<void> {
  const deleted = await db
    .delete(hostPlaces)
    .where(and(eq(hostPlaces.id, id), eq(hostPlaces.propertyId, propertyId)))
    .returning({ id: hostPlaces.id });
  if (deleted.length === 0) throw new HostPlaceRuleError('not-found');
}
