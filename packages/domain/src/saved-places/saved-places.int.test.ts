import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedTrogir } from '../catalog/seed/trogir';
import { createCatalogRecord } from '../catalog/store';
import { catalogRecords, destinations } from '../db/schema/catalog';
import { savedPlaces } from '../db/schema/saved-places';
import { spaces } from '../db/schema/spaces';
import {
  createTestDatabase,
  noopQueue,
  publishCatalog,
  seedGuestUnit,
  type TestDatabase,
} from '../testing';
import { listSavedPlaceIds, savePlace, unsavePlace } from './store';

const NOW = new Date('2027-07-10T08:00:00Z');

let testDb: TestDatabase;
let placeId: string;
let otherPlaceId: string;
let unpublishedId: string;
let foreignId: string;
let eventId: string;

beforeAll(async () => {
  testDb = await createTestDatabase();
  const db = testDb.db;
  const { destinationId } = await seedTrogir(db, noopQueue, NOW);
  await publishCatalog(db, destinationId);
  const places = await db
    .select({ id: catalogRecords.id })
    .from(catalogRecords)
    .where(and(eq(catalogRecords.destinationId, destinationId), eq(catalogRecords.kind, 'place')));
  const [first, second] = places;
  if (!first || !second) throw new Error('no places seeded');
  placeId = first.id;
  otherPlaceId = second.id;
  const [event] = await db
    .select({ id: catalogRecords.id })
    .from(catalogRecords)
    .where(and(eq(catalogRecords.destinationId, destinationId), eq(catalogRecords.kind, 'event')));
  if (!event) throw new Error('no event seeded');
  eventId = event.id;

  const unpublished = await createCatalogRecord(
    db,
    noopQueue,
    {
      destinationId,
      kind: 'place',
      placeCategory: 'beach',
      title: 'Hidden cove',
      description: 'A secret beach.',
      location: { x: 16.25, y: 43.51 },
    },
    NOW,
  );
  unpublishedId = unpublished.id;

  const [dubrovnik] = await db
    .insert(destinations)
    .values({ name: 'Dubrovnik', centre: { x: 18.0944, y: 42.6507 }, radiusM: 15_000 })
    .returning();
  if (!dubrovnik) throw new Error('no destination');
  const foreign = await createCatalogRecord(
    db,
    noopQueue,
    {
      destinationId: dubrovnik.id,
      kind: 'place',
      placeCategory: 'sight',
      title: 'Lovrijenac fortress',
      description: 'A fortress outside the city walls.',
      location: { x: 18.1043, y: 42.6406 },
    },
    NOW,
  );
  foreignId = foreign.id;
  await publishCatalog(db, dubrovnik.id);
});

afterAll(async () => {
  await testDb?.drop();
});

describe('saved places', () => {
  it('saves once, lists newest first and removes idempotently', async () => {
    const db = testDb.db;
    const { spaceId } = await seedGuestUnit(db, { now: NOW });
    expect(await listSavedPlaceIds(db, spaceId)).toEqual([]);

    expect(await savePlace(db, spaceId, placeId, NOW)).toBe('saved');
    expect(await savePlace(db, spaceId, placeId, new Date(NOW.getTime() + 1000))).toBe('saved');
    expect(await savePlace(db, spaceId, otherPlaceId, new Date(NOW.getTime() + 2000))).toBe(
      'saved',
    );
    expect(await listSavedPlaceIds(db, spaceId)).toEqual([otherPlaceId, placeId]);

    await unsavePlace(db, spaceId, placeId);
    await unsavePlace(db, spaceId, placeId);
    expect(await listSavedPlaceIds(db, spaceId)).toEqual([otherPlaceId]);
  });

  it('refuses what the guest could not find', async () => {
    const db = testDb.db;
    const { spaceId } = await seedGuestUnit(db, { now: NOW });
    for (const id of [unpublishedId, foreignId, eventId]) {
      expect(await savePlace(db, spaceId, id, NOW)).toBe('not-visible');
    }
    const outside = await seedGuestUnit(db, { now: NOW, location: null });
    expect(await savePlace(db, outside.spaceId, placeId, NOW)).toBe('not-visible');
    expect(await listSavedPlaceIds(db, spaceId)).toEqual([]);
  });

  it('goes with the Space', async () => {
    const db = testDb.db;
    const { spaceId } = await seedGuestUnit(db, { now: NOW });
    await savePlace(db, spaceId, placeId, NOW);
    await db.delete(spaces).where(eq(spaces.id, spaceId));
    const rows = await db.select().from(savedPlaces).where(eq(savedPlaces.spaceId, spaceId));
    expect(rows).toEqual([]);
  });
});
