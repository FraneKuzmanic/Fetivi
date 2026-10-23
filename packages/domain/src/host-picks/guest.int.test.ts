import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type CatalogScope,
  getPlace,
  listHostPicks,
  type PlaceSummary,
  searchPlaces,
} from '../catalog/search';
import { catalogRecommendations, catalogRecords } from '../db/schema/catalog';
import { hostPlaces } from '../db/schema/host-places';
import {
  createTestDatabase,
  noopQueue,
  publishCatalog,
  publishHostPlace,
  type SeededGuestUnit,
  seedDestination,
  seedGuestUnit,
  type TestDatabase,
} from '../testing';
import { hostPicksFor } from './guest';
import { createHostAddedPlace, createHostPick } from './store';

// The guest read side of host places, and its merge into the catalog search (40 AC 1, 2, 4). Two
// properties, A and B, in one destination: B's guests never see A's picks or added places.

const SUMMER = new Date('2027-07-10T08:00:00Z');
const SPOT = { lat: 43.52, lng: 16.26 };

let testDb: TestDatabase;
let destinationId: string;
let a: SeededGuestUnit;
let b: SeededGuestUnit;
let pantanId: string;
let mareId: string;
let anteId: string;

const scopeOf = (g: SeededGuestUnit): CatalogScope => ({
  destinationId,
  propertyId: g.propertyId,
  stayId: g.stayId,
  language: 'de',
  aboutMe: null,
});
const search = (g: SeededGuestUnit, q: Parameters<typeof searchPlaces>[2] = {}) =>
  searchPlaces(testDb.db, scopeOf(g), { limit: 20, ...q }, SUMMER).then((r) => r?.results ?? []);
const byId = (results: PlaceSummary[], id: string) => results.find((r) => r.id === id);

beforeAll(async () => {
  testDb = await createTestDatabase();
  const db = testDb.db;
  destinationId = await seedDestination(db);
  a = await seedGuestUnit(db, { now: SUMMER });
  b = await seedGuestUnit(db, { now: SUMMER });
  const insert = async (title: string, placeCategory: 'beach' | 'restaurant', at = SPOT) => {
    const [r] = await db
      .insert(catalogRecords)
      .values({
        destinationId,
        kind: 'place',
        title,
        description: `${title}, a good place.`,
        placeCategory,
        location: { x: at.lng, y: at.lat },
        verifiedAt: SUMMER,
      })
      .returning();
    if (!r) throw new Error('no record');
    return r.id;
  };
  pantanId = await insert('Plaza Pantan', 'beach', { lat: 43.53, lng: 16.28 });
  mareId = await insert('Konoba Mare', 'restaurant');
  await publishCatalog(db, destinationId);

  const pick = await createHostPick(
    db,
    noopQueue,
    a.propertyId,
    { recordId: pantanId, note: 'Go early' },
    SUMMER,
  );
  await publishHostPlace(db, pick.id);
  const ante = await createHostAddedPlace(
    db,
    noopQueue,
    a.propertyId,
    {
      name: 'Konoba Ante',
      placeCategory: 'restaurant',
      location: SPOT,
      address: 'Obala 1',
      note: 'Best grilled fish',
    },
    new Date(SUMMER.getTime() + 1000),
  );
  anteId = ante.id;
  await publishHostPlace(db, anteId);
  // Not yet translated: invisible.
  await createHostAddedPlace(
    db,
    noopQueue,
    a.propertyId,
    {
      name: 'Konoba Pending',
      placeCategory: 'restaurant',
      location: SPOT,
      address: null,
      note: 'Soon',
    },
    SUMMER,
  );
  // Outside the destination (written directly; the store refuses it): invisible.
  const [far] = await db
    .insert(hostPlaces)
    .values({
      propertyId: a.propertyId,
      name: 'Konoba Faraway',
      placeCategory: 'restaurant',
      location: { x: 18.09, y: 42.65 },
      note: 'Far',
    })
    .returning();
  if (!far) throw new Error('no host place');
  await publishHostPlace(db, far.id);
});

afterAll(async () => {
  await testDb?.drop();
});

describe('hostPicksFor', () => {
  it("gives the note in the guest's language to the picking property only", async () => {
    expect(await hostPicksFor(testDb.db, scopeOf(a), [pantanId, mareId])).toEqual(
      new Map([[pantanId, { note: '[de] Go early' }]]),
    );
    expect(await hostPicksFor(testDb.db, scopeOf(b), [pantanId, mareId])).toEqual(new Map());
  });
});

describe('searchPlaces with host places', () => {
  it("annotates A's pick and adds A's visible host-added place, for A's guests only", async () => {
    const forA = await search(a);
    expect(byId(forA, pantanId)).toMatchObject({
      hostPick: { note: '[de] Go early' },
      hostAdded: false,
    });
    expect(byId(forA, mareId)).toMatchObject({ hostPick: null, hostAdded: false });
    expect(byId(forA, anteId)).toEqual({
      id: anteId,
      kind: 'place',
      category: 'restaurant',
      title: '[de] Konoba Ante',
      summary: '[de] Best grilled fish',
      location: SPOT,
      distanceKm: expect.any(Number),
      travelMinutes: null,
      address: 'Obala 1',
      phone: null,
      websiteUrl: null,
      image: null,
      open: null,
      verifiedAt: null,
      staleness: { status: 'never_verified', staleAt: null },
      sources: [],
      offerIds: [],
      hostPick: { note: '[de] Best grilled fish' },
      hostAdded: true,
    });
    expect(forA.map((r) => r.title)).not.toContain('[de] Konoba Pending');
    expect(forA.map((r) => r.title)).not.toContain('[de] Konoba Faraway');

    const forB = await search(b);
    expect(forB.map((r) => r.id).sort()).toEqual([pantanId, mareId].sort());
    expect(byId(forB, pantanId)?.hostPick).toBeNull();
  });

  it('matches a host-added place on its translated name, ranked below an equal fresh catalog place', async () => {
    const konoba = await search(a, { query: 'konoba' });
    expect(konoba.map((r) => r.id)).toEqual([mareId, anteId]);
    expect((await search(a, { query: 'grilled fish' })).map((r) => r.id)).toEqual([anteId]);
  });

  it('applies the category and distance filters', async () => {
    expect((await search(a, { category: 'beach' })).map((r) => r.id)).toEqual([pantanId]);
    expect(await search(a, { category: 'day_trip' })).toEqual([]);
    expect(
      (await search(a, { category: 'restaurant', maxDistanceKm: 2 })).map((r) => r.id),
    ).toEqual([mareId, anteId]);
    expect(await search(a, { category: 'restaurant', maxDistanceKm: 0.3 })).toEqual([]);
  });

  it("answers 'unknown' for an asked time, never filtering a host-added place out", async () => {
    expect(byId(await search(a, { openAt: '23:00' }), anteId)?.open).toBe('unknown');
  });

  it('leaves host-added places out of rainy-day searches and when asked to', async () => {
    expect(byId(await search(a, { includeHostAdded: false }), anteId)).toBeUndefined();
    expect(byId(await search(a, { rainyDay: true }), anteId)).toBeUndefined();
  });

  it('counts recommendations for catalog results only', async () => {
    await testDb.db.delete(catalogRecommendations);
    const results = await search(a, { query: 'konoba' });
    expect(results.map((r) => r.id)).toContain(anteId);
    const counted = await testDb.db.select().from(catalogRecommendations);
    expect(counted.map((c) => c.recordId)).toEqual([mareId]);
  });
});

describe('getPlace and listHostPicks', () => {
  it("returns A's host-added place in full to A's guests only", async () => {
    expect(await getPlace(testDb.db, scopeOf(a), anteId, SUMMER)).toMatchObject({
      id: anteId,
      title: '[de] Konoba Ante',
      description: '[de] Best grilled fish',
      seasons: [],
      openingHours: [],
      inSeasonToday: true,
      images: [],
      hostAdded: true,
    });
    expect(await getPlace(testDb.db, scopeOf(b), anteId, SUMMER)).toBeNull();
    expect(await getPlace(testDb.db, scopeOf(a), pantanId, SUMMER)).toMatchObject({
      hostPick: { note: '[de] Go early' },
      hostAdded: false,
    });
    expect((await getPlace(testDb.db, scopeOf(b), pantanId, SUMMER))?.hostPick).toBeNull();
  });

  it('lists the picks and added places in the order the host added them', async () => {
    const forA = await listHostPicks(testDb.db, scopeOf(a), SUMMER);
    expect(forA?.map((p) => [p.id, p.hostAdded, p.hostPick?.note])).toEqual([
      [pantanId, false, '[de] Go early'],
      [anteId, true, '[de] Best grilled fish'],
    ]);
    expect(await listHostPicks(testDb.db, scopeOf(b), SUMMER)).toEqual([]);
  });

  it('hides a pick of a record that is no longer published', async () => {
    await testDb.db
      .update(catalogRecords)
      .set({ publishedRevision: null })
      .where(eq(catalogRecords.id, pantanId));
    expect((await listHostPicks(testDb.db, scopeOf(a), SUMMER))?.map((p) => p.id)).toEqual([
      anteId,
    ]);
    await testDb.db
      .update(catalogRecords)
      .set({ publishedRevision: 1 })
      .where(eq(catalogRecords.id, pantanId));
  });
});

describe('a promoted host-added place', () => {
  it('shows the host-added card until its record publishes, then the record as a pick, once', async () => {
    const [record] = await testDb.db
      .insert(catalogRecords)
      .values({
        destinationId,
        kind: 'place',
        title: 'Konoba Ante',
        description: 'Grilled fish.',
        placeCategory: 'restaurant',
        location: { x: SPOT.lng, y: SPOT.lat },
      })
      .returning();
    if (!record) throw new Error('no record');
    await testDb.db
      .update(hostPlaces)
      .set({ catalogRecordId: record.id })
      .where(eq(hostPlaces.id, anteId));

    const before = await search(a, { query: 'konoba ante' });
    expect(before.map((r) => [r.id, r.hostAdded])).toContainEqual([anteId, true]);
    expect(byId(before, record.id)).toBeUndefined();

    await publishCatalog(testDb.db, destinationId);
    const after = await search(a, { query: 'konoba ante' });
    expect(byId(after, anteId)).toBeUndefined();
    expect(after.filter((r) => r.id === record.id)).toEqual([
      expect.objectContaining({ hostPick: { note: '[de] Best grilled fish' }, hostAdded: false }),
    ]);
    expect((await listHostPicks(testDb.db, scopeOf(a), SUMMER))?.map((p) => p.id)).toEqual([
      pantanId,
      record.id,
    ]);
    expect(await getPlace(testDb.db, scopeOf(a), anteId, SUMMER)).toBeNull();
  });
});

describe('a pick whose note is its record description', () => {
  it('drops the note, so a host-added place approved as is does not repeat itself', async () => {
    const [record] = await testDb.db
      .insert(catalogRecords)
      .values({
        destinationId,
        kind: 'place',
        title: 'Pekara Duje',
        description: 'Fresh burek from 6 am.',
        placeCategory: 'restaurant',
        location: { x: SPOT.lng, y: SPOT.lat },
      })
      .returning();
    if (!record) throw new Error('no record');
    await publishCatalog(testDb.db, destinationId);
    const pick = await createHostPick(
      testDb.db,
      noopQueue,
      b.propertyId,
      { recordId: record.id, note: 'Fresh burek from 6 am.' },
      SUMMER,
    );
    await publishHostPlace(testDb.db, pick.id);
    expect(await hostPicksFor(testDb.db, scopeOf(b), [record.id])).toEqual(
      new Map([[record.id, { note: null }]]),
    );
  });
});
