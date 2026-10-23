import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { catalogRecords, destinations } from '../db/schema/catalog';
import { curationItems } from '../db/schema/curation';
import { hostPlaces } from '../db/schema/host-places';
import { QUEUES } from '../jobs/queue';
import {
  createTestDatabase,
  publishCatalog,
  recordingQueue,
  seedDestination,
  seedGuestUnit,
  type TestDatabase,
} from '../testing';
import {
  browseCatalogPlaces,
  createHostAddedPlace,
  createHostPick,
  deleteHostPlace,
  findOwnedHostPlace,
  type HostPlaceRuleError,
  listHostPlaces,
  updateHostPlace,
} from './store';
import { HOST_PLACE_LIMITS } from './vocabulary';

let testDb: TestDatabase;
let destinationId: string;
let hostId: string;
let propertyId: string;
const record: Record<'beach' | 'unpublished' | 'event' | 'elsewhere' | 'trip', string> = {
  beach: '',
  unpublished: '',
  event: '',
  elsewhere: '',
  trip: '',
};
const queue = recordingQueue();
const now = new Date('2027-07-10T10:00:00Z');
const later = new Date('2027-07-10T10:05:00Z');
const DUBROVNIK = { lat: 42.65, lng: 18.09 };
const IN_TROGIR = { lat: 43.52, lng: 16.25 };

const insertRecord = async (values: Partial<typeof catalogRecords.$inferInsert>) => {
  const [r] = await testDb.db
    .insert(catalogRecords)
    .values({
      destinationId,
      kind: 'place',
      title: 'Place',
      description: 'A place.',
      placeCategory: 'beach',
      location: { x: 16.27, y: 43.52 },
      ...values,
    })
    .returning();
  if (!r) throw new Error('no record');
  return r.id;
};

beforeAll(async () => {
  testDb = await createTestDatabase();
  destinationId = await seedDestination(testDb.db);
  const [far] = await testDb.db
    .insert(destinations)
    .values({ name: 'Dubrovnik', centre: { x: DUBROVNIK.lng, y: DUBROVNIK.lat }, radiusM: 10_000 })
    .returning();
  if (!far) throw new Error('no destination');
  ({ hostId, propertyId } = await seedGuestUnit(testDb.db));
  record.beach = await insertRecord({ title: 'Plaža Pantan' });
  record.trip = await insertRecord({ title: 'Krka', kind: 'day_trip', placeCategory: null });
  record.event = await insertRecord({
    title: 'Concert',
    kind: 'event',
    placeCategory: null,
    venueName: 'Fortress',
    startsAt: new Date('2027-07-11T18:00:00Z'),
    endsAt: new Date('2027-07-11T20:00:00Z'),
  });
  await publishCatalog(testDb.db, destinationId);
  record.unpublished = await insertRecord({ title: 'Unpublished' });
  const [elsewhere] = await testDb.db
    .insert(catalogRecords)
    .values({
      destinationId: far.id,
      kind: 'place',
      title: 'Banje',
      description: 'A beach.',
      placeCategory: 'beach',
      location: { x: DUBROVNIK.lng, y: DUBROVNIK.lat },
      publishedRevision: 1,
      translationStatus: 'published',
    })
    .returning();
  if (!elsewhere) throw new Error('no record');
  record.elsewhere = elsewhere.id;
});

afterAll(async () => {
  await testDb?.drop();
});

const snapshot = async (id: string) =>
  (await testDb.db.select().from(catalogRecords).where(eq(catalogRecords.id, id)))[0];

const rule = (code: HostPlaceRuleError['code']) =>
  expect.objectContaining({ name: 'HostPlaceRuleError', code });

const ADDED = {
  name: 'Konoba Ante',
  placeCategory: 'restaurant' as const,
  location: IN_TROGIR,
  address: 'Obala 1',
  note: 'Best fish in town.',
};

describe('host picks', () => {
  it('picks a record without a note and publishes it at once, leaving the record unchanged', async () => {
    const before = await snapshot(record.trip);
    const jobs = queue.jobs.length;
    const row = await createHostPick(
      testDb.db,
      queue,
      propertyId,
      { recordId: record.trip, note: null },
      now,
    );
    expect(row).toMatchObject({
      catalogRecordId: record.trip,
      note: null,
      publishedRevision: 1,
      translationStatus: 'published',
    });
    expect(queue.jobs.length).toBe(jobs);
    expect(await snapshot(record.trip)).toEqual(before);
  });

  it('picks a record with a note and enqueues its translation', async () => {
    const before = await snapshot(record.beach);
    const row = await createHostPick(
      testDb.db,
      queue,
      propertyId,
      { recordId: record.beach, note: 'Go early.' },
      later,
    );
    expect(row).toMatchObject({ publishedRevision: null, translationStatus: 'pending' });
    expect(queue.jobs.at(-1)).toMatchObject({
      name: QUEUES.translateHostPlace,
      data: { hostPlaceId: row.id, revision: 1 },
    });

    const edited = await updateHostPlace(
      testDb.db,
      queue,
      propertyId,
      row.id,
      { note: 'Go before nine.' },
      now,
    );
    expect(edited).toMatchObject({ revision: 2, translationStatus: 'pending' });
    const cleared = await updateHostPlace(
      testDb.db,
      queue,
      propertyId,
      row.id,
      { note: null },
      now,
    );
    expect(cleared).toMatchObject({
      revision: 3,
      note: null,
      publishedRevision: 3,
      translationStatus: 'published',
    });
    expect(await snapshot(record.beach)).toEqual(before);
  });

  it('refuses a second pick of the same record', async () => {
    await expect(
      createHostPick(testDb.db, queue, propertyId, { recordId: record.beach, note: null }, now),
    ).rejects.toEqual(rule('already-picked'));
  });

  it.each([
    ['unpublished', () => record.unpublished],
    ["another destination's", () => record.elsewhere],
    ['an event', () => record.event],
  ])('refuses %s record', async (_label, id) => {
    await expect(
      createHostPick(testDb.db, queue, propertyId, { recordId: id(), note: null }, now),
    ).rejects.toEqual(rule('invalid-input'));
  });

  it('refuses to change anything but the note of a pick', async () => {
    const [pick] = (await listHostPlaces(testDb.db, propertyId)).picks;
    if (!pick) throw new Error('no pick');
    await expect(
      updateHostPlace(testDb.db, queue, propertyId, pick.id, { name: 'Renamed' }, now),
    ).rejects.toEqual(rule('invalid-input'));
    await expect(
      updateHostPlace(testDb.db, queue, propertyId, pick.id, { location: IN_TROGIR }, now),
    ).rejects.toEqual(rule('invalid-input'));
  });

  it('refuses picks and added places outside a destination', async () => {
    const nowhere = await seedGuestUnit(testDb.db, { location: null });
    await expect(
      createHostPick(
        testDb.db,
        queue,
        nowhere.propertyId,
        { recordId: record.beach, note: null },
        now,
      ),
    ).rejects.toEqual(rule('no-destination'));
    await expect(
      createHostAddedPlace(testDb.db, queue, nowhere.propertyId, ADDED, now),
    ).rejects.toEqual(rule('no-destination'));
    await expect(browseCatalogPlaces(testDb.db, nowhere.propertyId)).rejects.toEqual(
      rule('no-destination'),
    );
    expect((await listHostPlaces(testDb.db, nowhere.propertyId)).destination).toBeNull();
  });
});

describe('host-added places', () => {
  it('adds a place and enqueues its translation and one host place suggestion', async () => {
    const row = await createHostAddedPlace(testDb.db, queue, propertyId, ADDED, now);
    expect(row).toMatchObject({ name: 'Konoba Ante', translationStatus: 'pending' });
    expect(queue.jobs.at(-1)).toMatchObject({
      name: QUEUES.translateHostPlace,
      data: { hostPlaceId: row.id, revision: 1 },
    });
    const items = await testDb.db
      .select()
      .from(curationItems)
      .where(eq(curationItems.kind, 'host_place_suggestion'));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      hostId,
      destinationId,
      status: 'open',
      dedupeKey: `host-place:${row.id}`,
      payload: {
        kind: 'host_place_suggestion',
        name: 'Konoba Ante',
        placeCategory: 'restaurant',
        location: IN_TROGIR,
        address: 'Obala 1',
        note: 'Best fish in town.',
        hostPlaceId: row.id,
      },
    });

    // An edit re-translates; the item stays the snapshot taken at creation.
    const edited = await updateHostPlace(
      testDb.db,
      queue,
      propertyId,
      row.id,
      { name: 'Konoba Ante i Mare', address: null },
      now,
    );
    expect(edited).toMatchObject({ revision: 2, address: null });
    const [item] = await testDb.db
      .select()
      .from(curationItems)
      .where(eq(curationItems.dedupeKey, `host-place:${row.id}`));
    expect(item?.payload).toMatchObject({ name: 'Konoba Ante', address: 'Obala 1' });

    // A move without a text change keeps the revision.
    const moved = await updateHostPlace(
      testDb.db,
      queue,
      propertyId,
      row.id,
      { location: { lat: 43.53, lng: 16.26 } },
      now,
    );
    expect(moved).toMatchObject({ revision: 2, location: { x: 16.26, y: 43.53 } });
  });

  it('refuses a place outside the property destination', async () => {
    const items = await testDb.db.select().from(curationItems);
    await expect(
      createHostAddedPlace(testDb.db, queue, propertyId, { ...ADDED, location: DUBROVNIK }, now),
    ).rejects.toEqual(rule('outside-destination'));
    const [added] = (await listHostPlaces(testDb.db, propertyId)).added;
    if (!added) throw new Error('no added place');
    await expect(
      updateHostPlace(testDb.db, queue, propertyId, added.id, { location: DUBROVNIK }, now),
    ).rejects.toEqual(rule('outside-destination'));
    expect(await testDb.db.select().from(curationItems)).toHaveLength(items.length);
  });

  it('takes a spot in the property destination that lies nearer an overlapping one', async () => {
    await testDb.db
      .insert(destinations)
      .values({ name: 'Split', centre: { x: 16.44, y: 43.508 }, radiusM: 15_000 });
    const [added] = (await listHostPlaces(testDb.db, propertyId)).added;
    if (!added) throw new Error('no added place');
    const nearSplit = { lat: 43.51, lng: 16.36 };
    await updateHostPlace(testDb.db, queue, propertyId, added.id, { location: nearSplit }, now);
    const [moved] = (await listHostPlaces(testDb.db, propertyId)).added;
    expect(moved?.location).toEqual(nearSplit);
    const back = added.location;
    await updateHostPlace(testDb.db, queue, propertyId, added.id, { location: back }, now);
  });

  it('refuses an empty note on an added place', async () => {
    const [added] = (await listHostPlaces(testDb.db, propertyId)).added;
    if (!added) throw new Error('no added place');
    await expect(
      updateHostPlace(testDb.db, queue, propertyId, added.id, { note: null }, now),
    ).rejects.toEqual(rule('invalid-input'));
  });
});

describe('listing, browsing, ownership and limits', () => {
  it('lists picks and added places in the order added, with the destination', async () => {
    const view = await listHostPlaces(testDb.db, propertyId);
    expect(view.destination?.id).toBe(destinationId);
    expect(view.picks.map((p) => p.recordId)).toEqual([record.trip, record.beach]);
    expect(view.picks[0]).toMatchObject({ title: 'Krka', kind: 'day_trip', note: null });
    expect(view.picks[1]).toMatchObject({ title: 'Plaža Pantan', placeCategory: 'beach' });
    expect(view.added).toEqual([
      expect.objectContaining({
        name: 'Konoba Ante i Mare',
        location: { lat: 43.53, lng: 16.26 },
        inCatalog: false,
        translation: { status: 'pending', error: null },
      }),
    ]);
  });

  it('browses published places and day trips of the destination, marking picks', async () => {
    const all = await browseCatalogPlaces(testDb.db, propertyId);
    expect(all.map((p) => p.title)).toEqual(['Krka', 'Plaža Pantan']);
    expect(all.every((p) => p.picked)).toBe(true);
    expect((await browseCatalogPlaces(testDb.db, propertyId, 'pant')).map((p) => p.id)).toEqual([
      record.beach,
    ]);
    expect(await browseCatalogPlaces(testDb.db, propertyId, '%')).toEqual([]);
  });

  it('finds a host place only for its own host, and scopes writes to the property', async () => {
    const other = await seedGuestUnit(testDb.db);
    const [pick] = (await listHostPlaces(testDb.db, propertyId)).picks;
    if (!pick) throw new Error('no pick');
    expect(await findOwnedHostPlace(testDb.db, hostId, pick.id)).toEqual({
      id: pick.id,
      propertyId,
    });
    expect(await findOwnedHostPlace(testDb.db, other.hostId, pick.id)).toBeNull();
    await expect(
      updateHostPlace(testDb.db, queue, other.propertyId, pick.id, { note: 'x' }, now),
    ).rejects.toEqual(rule('not-found'));
    await expect(deleteHostPlace(testDb.db, other.propertyId, pick.id)).rejects.toEqual(
      rule('not-found'),
    );
  });

  it('refuses the 21st place, and deleting frees a slot', async () => {
    const existing = await testDb.db
      .select()
      .from(hostPlaces)
      .where(eq(hostPlaces.propertyId, propertyId));
    for (let i = existing.length; i < HOST_PLACE_LIMITS.perProperty; i++) {
      await createHostAddedPlace(testDb.db, queue, propertyId, { ...ADDED, name: `P${i}` }, now);
    }
    await expect(createHostAddedPlace(testDb.db, queue, propertyId, ADDED, now)).rejects.toEqual(
      rule('limit-reached'),
    );
    const [pick] = (await listHostPlaces(testDb.db, propertyId)).picks;
    if (!pick) throw new Error('no pick');
    const before = await snapshot(pick.recordId);
    await deleteHostPlace(testDb.db, propertyId, pick.id);
    expect(await snapshot(pick.recordId)).toEqual(before);
    await createHostPick(
      testDb.db,
      queue,
      propertyId,
      { recordId: pick.recordId, note: null },
      now,
    );
  });
});
