import {
  type Amenity,
  type BlockRow,
  type Db,
  type EffectiveUnit,
  type Executor,
  enqueueTranslation,
  infoBlocks,
  type JobQueue,
  loadEffectiveUnit,
  newQrSlug,
  type PropertyRow,
  properties,
  propertyAmenities,
  SHARED_CORE_FIELDS,
  type SharedCore,
  type UnitRow,
  unitAmenities,
  unitHiddenBlocks,
  units,
} from '@fetivi/domain';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { HttpError } from '../http-error';
import { unitLink } from './qr';

// All reads and writes of host data, scoped by the host id from request.auth. A row that exists
// but belongs to another host is reported exactly like a missing one: 404, no existence oracle.

const notFound = () => new HttpError(404, 'not-found');

/** The ids of the host's properties, as a subquery for ownership checks inside one statement. */
export const ownedPropertyIds = (db: Executor, hostId: string) =>
  db.select({ id: properties.id }).from(properties).where(eq(properties.hostId, hostId));

export const ownedUnitIds = (db: Executor, hostId: string) =>
  db
    .select({ id: units.id })
    .from(units)
    .innerJoin(properties, eq(units.propertyId, properties.id))
    .where(eq(properties.hostId, hostId));

export async function findOwnedProperty(db: Executor, hostId: string, id: string) {
  const [property] = await db
    .select()
    .from(properties)
    .where(and(eq(properties.id, id), eq(properties.hostId, hostId)));
  if (!property) throw notFound();
  return property;
}

export async function findOwnedUnit(db: Executor, hostId: string, id: string) {
  const [row] = await db
    .select({ unit: units, property: properties })
    .from(units)
    .innerJoin(properties, eq(units.propertyId, properties.id))
    .where(and(eq(units.id, id), eq(properties.hostId, hostId)));
  if (!row) throw notFound();
  return row;
}

/** A block of the host's, whether a property owns it directly or through one of its units. */
export async function findOwnedBlock(db: Executor, hostId: string, id: string) {
  const [block] = await db
    .select()
    .from(infoBlocks)
    .where(and(eq(infoBlocks.id, id), ownedBlockCondition(db, hostId)));
  if (!block) throw notFound();
  return block;
}

function ownedBlockCondition(db: Executor, hostId: string) {
  return or(
    inArray(infoBlocks.propertyId, ownedPropertyIds(db, hostId)),
    inArray(infoBlocks.unitId, ownedUnitIds(db, hostId)),
  );
}

// --- Blocks -----------------------------------------------------------------------------------

type NewBlock = typeof infoBlocks.$inferInsert;
type BlockChanges = Partial<
  Pick<NewBlock, 'category' | 'title' | 'body' | 'visibility' | 'position'>
>;

export async function countBlocks(
  db: Executor,
  owner: { propertyId: string } | { unitId: string },
) {
  const where =
    'propertyId' in owner
      ? eq(infoBlocks.propertyId, owner.propertyId)
      : eq(infoBlocks.unitId, owner.unitId);
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(infoBlocks).where(where);
  return row?.n ?? 0;
}

/**
 * The one write path for block content. An insert starts at revision 1; an update adds one only
 * when the title or body changes. Each new revision enqueues its translation job in the same
 * transaction, keyed by (block id, revision).
 */
export async function saveBlock(
  db: Db,
  queue: JobQueue,
  write:
    | { insert: NewBlock }
    | { update: { id: string; hostId: string; changes: BlockChanges; now: Date } },
): Promise<BlockRow> {
  return db.transaction(async (tx) => {
    if ('insert' in write) {
      const [block] = await tx.insert(infoBlocks).values(write.insert).returning();
      if (!block) throw new Error('block insert returned nothing');
      await enqueueTranslation(tx, queue, block);
      return block;
    }
    const { id, hostId, changes, now } = write.update;
    // Locked, so two concurrent saves still produce two distinct revisions.
    const [current] = await tx
      .select()
      .from(infoBlocks)
      .where(and(eq(infoBlocks.id, id), ownedBlockCondition(tx, hostId)))
      .for('update');
    if (!current) throw notFound();
    // The editor always sends every field, so compare values, not presence.
    const textChanged =
      (changes.title !== undefined && changes.title !== current.title) ||
      (changes.body !== undefined && changes.body !== current.body);
    const [block] = await tx
      .update(infoBlocks)
      .set({
        ...changes,
        updatedAt: now,
        ...(textChanged
          ? {
              revision: current.revision + 1,
              translationStatus: 'pending' as const,
              translationError: null,
              sourceLanguage: null,
            }
          : {}),
      })
      .where(eq(infoBlocks.id, id))
      .returning();
    if (!block) throw notFound();
    if (textChanged) await enqueueTranslation(tx, queue, block);
    return block;
  });
}

// --- Slugs and amenities ----------------------------------------------------------------------

function pgCode(error: unknown): string | undefined {
  const e = error as { code?: string; cause?: { code?: string } };
  return e.code ?? e.cause?.code;
}

/** Gives the unit a QR slug unless it has one. Slugs are permanent. */
export async function issueSlug(tx: Executor, unitId: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      // A savepoint, so a slug collision does not abort the surrounding transaction.
      await tx.transaction(async (sp) => {
        await sp
          .update(units)
          .set({ qrSlug: newQrSlug() })
          .where(and(eq(units.id, unitId), isNull(units.qrSlug)));
      });
      return;
    } catch (error) {
      if (pgCode(error) !== '23505' || attempt >= 3) throw error;
    }
  }
}

export interface AmenityInput {
  amenity: Amenity;
  note?: string | null | undefined;
}

export async function replacePropertyAmenities(db: Db, propertyId: string, list: AmenityInput[]) {
  await db.transaction(async (tx) => {
    await tx.delete(propertyAmenities).where(eq(propertyAmenities.propertyId, propertyId));
    if (list.length > 0) {
      await tx
        .insert(propertyAmenities)
        .values(list.map((a) => ({ propertyId, amenity: a.amenity, note: a.note ?? null })));
    }
  });
  return listPropertyAmenities(db, propertyId);
}

export async function replaceUnitAmenities(db: Db, unitId: string, list: AmenityInput[]) {
  await db.transaction(async (tx) => {
    await tx.delete(unitAmenities).where(eq(unitAmenities.unitId, unitId));
    if (list.length > 0) {
      await tx
        .insert(unitAmenities)
        .values(list.map((a) => ({ unitId, amenity: a.amenity, note: a.note ?? null })));
    }
  });
  return listUnitAmenities(db, unitId);
}

const listPropertyAmenities = (db: Executor, propertyId: string) =>
  db
    .select({ amenity: propertyAmenities.amenity, note: propertyAmenities.note })
    .from(propertyAmenities)
    .where(eq(propertyAmenities.propertyId, propertyId))
    .orderBy(asc(propertyAmenities.amenity));

const listUnitAmenities = (db: Executor, unitId: string) =>
  db
    .select({ amenity: unitAmenities.amenity, note: unitAmenities.note })
    .from(unitAmenities)
    .where(eq(unitAmenities.unitId, unitId))
    .orderBy(asc(unitAmenities.amenity));

// --- Response shapes --------------------------------------------------------------------------

const TIME_FIELDS = new Set(['checkInTime', 'checkoutTime', 'quietHoursFrom', 'quietHoursTo']);

/** Shared core fields as the API sends them: times as 'HH:MM'. */
export function coreOut(row: SharedCore): SharedCore {
  const out = {} as Record<string, unknown>;
  for (const field of SHARED_CORE_FIELDS) {
    const value = row[field];
    out[field] = TIME_FIELDS.has(field) && typeof value === 'string' ? value.slice(0, 5) : value;
  }
  return out as SharedCore;
}

const locationOut = (location: PropertyRow['location']) =>
  location ? { lat: location.y, lng: location.x } : null;

export function blockOut(b: BlockRow) {
  return {
    id: b.id,
    propertyId: b.propertyId,
    unitId: b.unitId,
    category: b.category,
    title: b.title,
    body: b.body,
    visibility: b.visibility,
    revision: b.revision,
    translation: {
      status: b.translationStatus,
      error: b.translationError,
      publishedRevision: b.publishedRevision,
      sourceLanguage: b.sourceLanguage,
    },
    replacesBlockId: b.replacesBlockId,
    position: b.position,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

const blocksOf = (db: Executor, where: ReturnType<typeof eq>) =>
  db
    .select()
    .from(infoBlocks)
    .where(where)
    .orderBy(asc(infoBlocks.position), asc(infoBlocks.createdAt));

export async function propertyDetail(db: Executor, property: PropertyRow) {
  const [amenities, blocks, unitRows] = await Promise.all([
    listPropertyAmenities(db, property.id),
    blocksOf(db, eq(infoBlocks.propertyId, property.id)),
    db
      .select({ id: units.id, name: units.name, qrSlug: units.qrSlug })
      .from(units)
      .where(eq(units.propertyId, property.id))
      .orderBy(asc(units.createdAt)),
  ]);
  return {
    id: property.id,
    name: property.name,
    addressLine: property.addressLine,
    city: property.city,
    postalCode: property.postalCode,
    country: property.country,
    location: locationOut(property.location),
    timezone: property.timezone,
    buildingDoorCode: property.buildingDoorCode,
    ...coreOut(property),
    approved: property.approvedAt !== null,
    approvedAt: property.approvedAt?.toISOString() ?? null,
    createdAt: property.createdAt.toISOString(),
    updatedAt: property.updatedAt.toISOString(),
    amenities,
    blocks: blocks.map(blockOut),
    units: unitRows,
  };
}

function effectiveOut(e: EffectiveUnit) {
  return {
    ...e,
    ...coreOut(e),
    location: locationOut(e.location),
    approvedAt: e.approvedAt?.toISOString() ?? null,
    blocks: e.blocks.map((b) => ({ ...blockOut(b), source: b.source })),
  };
}

export async function unitDetail(
  db: Db,
  { unit, property }: { unit: UnitRow; property: PropertyRow },
  guestOrigin: string,
) {
  const [amenities, inheritedAmenities, ownBlocks, propertyBlocks, hidden, effective] =
    await Promise.all([
      listUnitAmenities(db, unit.id),
      listPropertyAmenities(db, property.id),
      blocksOf(db, eq(infoBlocks.unitId, unit.id)),
      blocksOf(db, eq(infoBlocks.propertyId, property.id)),
      db
        .select({ blockId: unitHiddenBlocks.blockId })
        .from(unitHiddenBlocks)
        .where(eq(unitHiddenBlocks.unitId, unit.id)),
      loadEffectiveUnit(db, unit.id),
    ]);
  if (!effective) throw notFound();
  return {
    id: unit.id,
    propertyId: property.id,
    propertyName: property.name,
    name: unit.name,
    qrSlug: unit.qrSlug,
    qrLink: unit.qrSlug ? unitLink(guestOrigin, unit.qrSlug) : null,
    approved: property.approvedAt !== null,
    timezone: property.timezone,
    ...coreOut(unit),
    noWifi: unit.noWifi,
    wifiNetwork: unit.wifiNetwork,
    wifiPassword: unit.wifiPassword,
    doorCode: unit.doorCode,
    lockboxCode: unit.lockboxCode,
    maxOccupancy: unit.maxOccupancy,
    bedrooms: unit.bedrooms,
    beds: unit.beds,
    bathrooms: unit.bathrooms,
    arrivalReleaseDaysBefore: unit.arrivalReleaseDaysBefore,
    createdAt: unit.createdAt.toISOString(),
    updatedAt: unit.updatedAt.toISOString(),
    /** The property's own values, so the form can show what an empty field inherits. */
    propertyValues: coreOut(property),
    propertyAmenities: inheritedAmenities,
    amenities,
    blocks: ownBlocks.map(blockOut),
    /** Every property block, hidden ones included, so a unit can hide, unhide or replace them. */
    propertyBlocks: propertyBlocks.map(blockOut),
    hiddenBlockIds: hidden.map((h) => h.blockId),
    effective: effectiveOut(effective),
  };
}

export async function listProperties(db: Db, hostId: string) {
  const rows = await db
    .select()
    .from(properties)
    .where(eq(properties.hostId, hostId))
    .orderBy(desc(properties.createdAt));
  const unitRows =
    rows.length === 0
      ? []
      : await db
          .select({
            id: units.id,
            name: units.name,
            propertyId: units.propertyId,
            qrSlug: units.qrSlug,
          })
          .from(units)
          .where(
            inArray(
              units.propertyId,
              rows.map((r) => r.id),
            ),
          )
          .orderBy(asc(units.createdAt));
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    city: p.city,
    approved: p.approvedAt !== null,
    units: unitRows
      .filter((u) => u.propertyId === p.id)
      .map((u) => ({ id: u.id, name: u.name, hasQr: u.qrSlug !== null })),
  }));
}
