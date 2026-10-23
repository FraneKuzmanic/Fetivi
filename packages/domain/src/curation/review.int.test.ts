import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { searchPlaces } from '../catalog/search';
import { createCatalogRecord, updateCatalogRecord } from '../catalog/store';
import { accounts } from '../db/schema/accounts';
import { catalogRecords } from '../db/schema/catalog';
import { curationItems } from '../db/schema/curation';
import { hostPlaces } from '../db/schema/host-places';
import { createHostAddedPlace, deleteHostPlace } from '../host-picks/store';
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
import {
  approveCurationItem,
  CurationRuleError,
  countCurationItems,
  editCurationItem,
  listCurationItems,
  markNeedsVisit,
  rejectCurationItem,
} from './review';
import { enqueueCurationItem } from './store';
import type { CurationPayload } from './vocabulary';

const NOW = new Date('2027-07-10T09:00:00Z');
const LATER = new Date('2027-07-11T09:00:00Z');

let testDb: TestDatabase;
let destinationId: string;
let adminId: string;
let deps: { db: TestDatabase['db']; queue: typeof noopQueue };

beforeAll(async () => {
  testDb = await createTestDatabase();
  deps = { db: testDb.db, queue: noopQueue };
  destinationId = await seedDestination(testDb.db);
  const [admin] = await testDb.db
    .insert(accounts)
    .values({ email: 'curator@example.test', passwordHash: 'x', role: 'admin' })
    .returning();
  if (!admin) throw new Error('no admin');
  adminId = admin.id;
});

afterAll(async () => {
  await testDb?.drop();
});

async function place(title = 'Konoba Old') {
  const record = await createCatalogRecord(
    testDb.db,
    noopQueue,
    {
      destinationId,
      kind: 'place',
      title,
      description: 'Old text.',
      placeCategory: 'restaurant',
      location: { x: 16.25, y: 43.51 },
    },
    NOW,
  );
  return record.id;
}

async function enqueue(
  payload: CurationPayload,
  over: { recordId?: string; destinationId?: string | null } = {},
) {
  const { id } = await enqueueCurationItem(
    testDb.db,
    {
      destinationId: over.destinationId === undefined ? destinationId : over.destinationId,
      recordId: over.recordId,
      payload,
    },
    NOW,
  );
  return id;
}

async function recordOf(id: string) {
  const [r] = await testDb.db.select().from(catalogRecords).where(eq(catalogRecords.id, id));
  if (!r) throw new Error('no record');
  return r;
}

async function itemOf(id: string) {
  const [r] = await testDb.db.select().from(curationItems).where(eq(curationItems.id, id));
  if (!r) throw new Error('no item');
  return r;
}

const draft = (title: string): CurationPayload => ({
  kind: 'draft',
  changes: { title, description: 'New text.', fieldSources: { title: 'https://example.test/a' } },
});

async function rejects(run: Promise<unknown>, code: CurationRuleError['code']) {
  await expect(run).rejects.toSatisfy((e) => e instanceof CurationRuleError && e.code === code);
}

describe('approveCurationItem', () => {
  it('applies a draft and verifies the record', async () => {
    const recordId = await place();
    const id = await enqueue(draft('Konoba New'), { recordId });
    const row = await approveCurationItem(deps, id, adminId, LATER);
    expect(row).toMatchObject({
      status: 'approved',
      reviewedAt: LATER,
      reviewedBy: adminId,
      appliedAt: LATER,
    });
    expect(await recordOf(recordId)).toMatchObject({
      title: 'Konoba New',
      description: 'New text.',
      fieldSources: { title: 'https://example.test/a' },
      verifiedAt: LATER,
      verifiedBy: adminId,
    });
  });

  it('keeps the admin edits made after Edit', async () => {
    const recordId = await place();
    const id = await enqueue(draft('Draft title'), { recordId });
    expect(await editCurationItem(deps, id, NOW)).toEqual({ recordId });
    expect((await recordOf(recordId)).title).toBe('Draft title');
    expect((await itemOf(id)).status).toBe('open');
    await updateCatalogRecord(testDb.db, noopQueue, recordId, { title: 'Admin title' }, NOW);
    await approveCurationItem(deps, id, adminId, LATER);
    expect(await recordOf(recordId)).toMatchObject({ title: 'Admin title', verifiedAt: LATER });
    expect((await itemOf(id)).appliedAt).toEqual(NOW);
  });

  it('only verifies on a guest flag', async () => {
    const recordId = await place('Flagged');
    const id = await enqueue({ kind: 'guest_flagged', reason: 'outdated', count: 3 }, { recordId });
    await approveCurationItem(deps, id, adminId, LATER);
    expect(await recordOf(recordId)).toMatchObject({
      title: 'Flagged',
      description: 'Old text.',
      verifiedAt: LATER,
    });
  });

  it('creates and verifies a suggested place', async () => {
    const id = await enqueue({
      kind: 'host_place_suggestion',
      name: 'Hidden Cove',
      placeCategory: 'beach',
      location: { lat: 43.5, lng: 16.2 },
      address: 'Okrug',
      note: 'Quiet beach.',
    });
    const row = await approveCurationItem(deps, id, adminId, LATER);
    expect(row.recordId).not.toBeNull();
    expect(await recordOf(row.recordId as string)).toMatchObject({
      destinationId,
      kind: 'place',
      title: 'Hidden Cove',
      description: 'Quiet beach.',
      placeCategory: 'beach',
      address: 'Okrug',
      verifiedAt: LATER,
    });
  });

  it('rejects a bad suggested category or a missing destination', async () => {
    const suggestion = {
      kind: 'host_place_suggestion' as const,
      name: 'X',
      location: { lat: 43.5, lng: 16.2 },
      address: null,
      note: null,
    };
    const bad = await enqueue({ ...suggestion, placeCategory: 'casino' });
    await rejects(approveCurationItem(deps, bad, adminId, LATER), 'invalid-input');
    const nowhere = await enqueue(
      { ...suggestion, placeCategory: 'beach' },
      { destinationId: null },
    );
    await rejects(approveCurationItem(deps, nowhere, adminId, LATER), 'invalid-input');
    expect((await itemOf(bad)).status).toBe('open');
  });

  it('only closes a Provider suggestion or a fallback cluster', async () => {
    const provider = await enqueue({
      kind: 'host_provider_suggestion',
      name: 'Boat',
      contact: null,
      note: null,
    });
    const cluster = await enqueue({
      kind: 'fallback_topic_cluster',
      topic: 'kayak rental',
      topics: ['kayak rental'],
      places: [],
      count: 2,
      noResults: 1,
      weekStart: '2027-07-05',
    });
    await rejects(editCurationItem(deps, provider, NOW), 'invalid-input');
    await rejects(editCurationItem(deps, cluster, NOW), 'invalid-input');
    for (const id of [provider, cluster]) {
      const row = await approveCurationItem(deps, id, adminId, LATER);
      expect(row).toMatchObject({ status: 'approved', recordId: null, appliedAt: null });
    }
  });

  it('refuses a draft or refresh diff with no record to apply it to', async () => {
    const orphan = await enqueue(draft('Nowhere'));
    await rejects(approveCurationItem(deps, orphan, adminId, LATER), 'invalid-input');
    await rejects(editCurationItem(deps, orphan, NOW), 'invalid-input');
    expect(await itemOf(orphan)).toMatchObject({ status: 'open', appliedAt: null });
  });

  it("drops source URLs for fields the record's kind does not have", async () => {
    const recordId = await place('Sources');
    const id = await enqueue(
      {
        kind: 'draft',
        changes: {
          phone: '+385 21 000 000',
          fieldSources: { phone: 'https://example.test/p', venueName: 'https://example.test/v' },
        },
      },
      { recordId },
    );
    await approveCurationItem(deps, id, adminId, LATER);
    expect((await recordOf(recordId)).fieldSources).toEqual({ phone: 'https://example.test/p' });
  });

  it('refuses a second review and an unknown id', async () => {
    const recordId = await place();
    const id = await enqueue({ kind: 'guest_flagged', reason: 'wrong', count: 1 }, { recordId });
    await approveCurationItem(deps, id, adminId, NOW);
    await rejects(approveCurationItem(deps, id, adminId, LATER), 'not-reviewable');
    await rejects(rejectCurationItem(testDb.db, id, adminId, LATER), 'not-reviewable');
    expect((await recordOf(recordId)).verifiedAt).toEqual(NOW);
    const unknown = '00000000-0000-4000-8000-000000000000';
    await rejects(approveCurationItem(deps, unknown, adminId, LATER), 'not-found');
    await rejects(markNeedsVisit(testDb.db, unknown, adminId, LATER), 'not-found');
  });
});

describe('reject and needs a visit', () => {
  it('reject closes the item and leaves the record alone', async () => {
    const recordId = await place('Untouched');
    const id = await enqueue(draft('Never applied'), { recordId });
    await rejectCurationItem(testDb.db, id, adminId, LATER);
    expect(await itemOf(id)).toMatchObject({
      status: 'rejected',
      reviewedAt: LATER,
      reviewedBy: adminId,
    });
    expect(await recordOf(recordId)).toMatchObject({ title: 'Untouched', verifiedAt: null });
  });

  it('needs a visit parks the item, which can still be approved', async () => {
    const recordId = await place();
    const id = await enqueue({ kind: 'guest_flagged', reason: 'outdated', count: 1 }, { recordId });
    await markNeedsVisit(testDb.db, id, adminId, NOW);
    expect((await itemOf(id)).status).toBe('needs_visit');
    expect((await recordOf(recordId)).verifiedAt).toBeNull();
    await markNeedsVisit(testDb.db, id, adminId, NOW);
    await approveCurationItem(deps, id, adminId, LATER);
    expect((await recordOf(recordId)).verifiedAt).toEqual(LATER);
  });
});

describe('listCurationItems and countCurationItems', () => {
  it('filters by status, kind and destination, and zero-fills counts', async () => {
    const db = await createTestDatabase();
    try {
      const destA = await seedDestination(db.db);
      const destB = await seedDestination(db.db);
      const local = { db: db.db, queue: noopQueue };
      const [admin] = await db.db
        .insert(accounts)
        .values({ email: 'a@example.test', passwordHash: 'x', role: 'admin' })
        .returning();
      if (!admin) throw new Error('no admin');
      const provider = (name: string) => ({
        kind: 'host_provider_suggestion' as const,
        name,
        contact: null,
        note: null,
      });
      const at = (h: number) => new Date(NOW.getTime() + h * 3_600_000);
      const first = await enqueueCurationItem(
        db.db,
        { destinationId: destA, payload: provider('first') },
        at(0),
      );
      const second = await enqueueCurationItem(
        db.db,
        { destinationId: destB, payload: provider('second') },
        at(1),
      );
      const cluster = await enqueueCurationItem(
        db.db,
        {
          destinationId: destA,
          payload: {
            kind: 'fallback_topic_cluster',
            topic: 't',
            topics: ['t'],
            places: [],
            count: 1,
            noResults: 0,
            weekStart: '2027-07-05',
          },
        },
        at(2),
      );
      const done1 = await enqueueCurationItem(db.db, { payload: provider('done1') }, at(3));
      const done2 = await enqueueCurationItem(db.db, { payload: provider('done2') }, at(4));
      await rejectCurationItem(db.db, done1.id, admin.id, at(10));
      await approveCurationItem(local, done2.id, admin.id, at(5));

      const open = await listCurationItems(db.db, { status: 'open' });
      expect(open.map((i) => i.id)).toEqual([first.id, second.id, cluster.id]);
      expect(open[0]).toMatchObject({ destination: { id: destA }, host: null, record: null });
      expect(
        (await listCurationItems(db.db, { status: 'open', kind: 'fallback_topic_cluster' })).map(
          (i) => i.id,
        ),
      ).toEqual([cluster.id]);
      expect(
        (await listCurationItems(db.db, { status: 'open', destinationId: destB })).map((i) => i.id),
      ).toEqual([second.id]);
      expect((await listCurationItems(db.db, { status: 'done' })).map((i) => i.id)).toEqual([
        done1.id,
        done2.id,
      ]);
      expect(await listCurationItems(db.db, { status: 'needs_visit' })).toEqual([]);

      expect(await countCurationItems(db.db, { status: 'open' })).toEqual({
        draft: 0,
        refresh_diff: 0,
        guest_flagged: 0,
        host_place_suggestion: 0,
        host_provider_suggestion: 2,
        fallback_topic_cluster: 1,
      });
      expect(
        (await countCurationItems(db.db, { status: 'open', destinationId: destA }))
          .host_provider_suggestion,
      ).toBe(1);
    } finally {
      await db.drop();
    }
  });
});

describe('a host place suggestion from a host-added place (40)', () => {
  let guest: SeededGuestUnit;
  let other: SeededGuestUnit;
  beforeAll(async () => {
    guest = await seedGuestUnit(testDb.db, { now: NOW });
    other = await seedGuestUnit(testDb.db, { now: NOW });
  });

  const addPlace = async (name: string, propertyId = guest.propertyId) => {
    const row = await createHostAddedPlace(
      testDb.db,
      noopQueue,
      propertyId,
      {
        name,
        placeCategory: 'restaurant',
        location: { lat: 43.52, lng: 16.26 },
        address: null,
        note: `${name} has the best fish.`,
      },
      NOW,
    );
    await publishHostPlace(testDb.db, row.id);
    const [item] = await testDb.db
      .select()
      .from(curationItems)
      .where(eq(curationItems.dedupeKey, `host-place:${row.id}`));
    if (!item) throw new Error('no item');
    return { hostPlaceId: row.id, itemId: item.id };
  };
  const linkOf = async (id: string) =>
    (await testDb.db.select().from(hostPlaces).where(eq(hostPlaces.id, id)))[0]?.catalogRecordId;
  const searchAs = (g: SeededGuestUnit, query: string, ids: string[]) =>
    searchPlaces(
      testDb.db,
      {
        destinationId,
        propertyId: g.propertyId,
        stayId: g.stayId,
        language: 'de',
        aboutMe: null,
      },
      { query, limit: 20 },
      NOW,
    ).then((r) =>
      (r?.results ?? [])
        .filter((p) => ids.includes(p.id))
        .map((p) => ({ id: p.id, hostPick: p.hostPick, hostAdded: p.hostAdded })),
    );

  it('approve links the host place; once published, guests see the record as a pick, once', async () => {
    const { hostPlaceId, itemId } = await addPlace('Konoba Linked');
    const row = await approveCurationItem(deps, itemId, adminId, LATER);
    const recordId = row.recordId as string;
    expect(await linkOf(hostPlaceId)).toBe(recordId);

    // Until the record publishes, the host-added card stays.
    expect(await searchAs(guest, 'konoba linked', [hostPlaceId, recordId])).toEqual([
      {
        id: hostPlaceId,
        hostPick: { note: '[de] Konoba Linked has the best fish.' },
        hostAdded: true,
      },
    ]);
    await publishCatalog(testDb.db, destinationId);
    // The record's description is the note, so the pick does not repeat it.
    expect(await searchAs(guest, 'konoba linked', [hostPlaceId, recordId])).toEqual([
      { id: recordId, hostPick: { note: null }, hostAdded: false },
    ]);
    // Another property's guests see the record, without the pick.
    expect(await searchAs(other, 'konoba linked', [hostPlaceId, recordId])).toEqual([
      { id: recordId, hostPick: null, hostAdded: false },
    ]);
  });

  it('edit links the host place too', async () => {
    const { hostPlaceId, itemId } = await addPlace('Konoba Edited');
    const { recordId } = await editCurationItem(deps, itemId, NOW);
    expect(await linkOf(hostPlaceId)).toBe(recordId);
  });

  it('reject leaves the host place visible to its own guests only', async () => {
    const { hostPlaceId, itemId } = await addPlace('Konoba Rejected');
    await rejectCurationItem(testDb.db, itemId, adminId, LATER);
    expect(await linkOf(hostPlaceId)).toBeNull();
    expect(await searchAs(guest, 'konoba rejected', [hostPlaceId])).toEqual([
      {
        id: hostPlaceId,
        hostPick: { note: '[de] Konoba Rejected has the best fish.' },
        hostAdded: true,
      },
    ]);
    expect(await searchAs(other, 'konoba rejected', [hostPlaceId])).toEqual([]);
  });

  it('approve still creates the record when the host deleted the place meanwhile', async () => {
    const { hostPlaceId, itemId } = await addPlace('Konoba Gone');
    await deleteHostPlace(testDb.db, guest.propertyId, hostPlaceId);
    const row = await approveCurationItem(deps, itemId, adminId, LATER);
    expect((await recordOf(row.recordId as string)).title).toBe('Konoba Gone');
  });
});
