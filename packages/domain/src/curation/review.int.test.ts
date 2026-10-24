import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { searchPlaces } from '../catalog/search';
import { draftCandidates, groupUnassigned, upsertSourceRows } from '../catalog/seeding/store';
import { createCatalogRecord, updateCatalogRecord } from '../catalog/store';
import { accounts } from '../db/schema/accounts';
import {
  catalogOpeningHours,
  catalogRecords,
  catalogSeasons,
  placeImages,
  placeOpenDataSources,
} from '../db/schema/catalog';
import { curationItems } from '../db/schema/curation';
import { hostPlaces } from '../db/schema/host-places';
import { seedingCandidates } from '../db/schema/seeding';
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
  getCurationItem,
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

  it("names a seeding candidate's waiting draft, and nothing else", async () => {
    await upsertSourceRows(
      testDb.db,
      destinationId,
      [
        {
          source: 'bathing_water',
          externalId: 'HRBWC-REVIEW-1',
          name: 'Saldun',
          location: { lat: 43.51046, lng: 16.25093 },
          placeCategory: 'beach',
          licence: 'CC-BY-4.0',
          sourceUrl: null,
          data: {},
        },
      ],
      NOW,
    );
    await groupUnassigned(testDb.db, destinationId, NOW);
    const [row] = await testDb.db.query.placeOpenDataSources.findMany({
      where: (t, { eq }) => eq(t.externalId, 'HRBWC-REVIEW-1'),
    });
    const candidateId = row?.candidateId;
    if (!candidateId) throw new Error('no candidate');
    await draftCandidates(testDb.db, noopQueue, destinationId, [candidateId], adminId, NOW);
    const [item] = await testDb.db.query.curationItems.findMany({
      where: (t, { eq }) => eq(t.dedupeKey, `seeding-candidate:${candidateId}`),
    });
    if (!item) throw new Error('no item');
    expect(await getCurationItem(testDb.db, item.id)).toMatchObject({
      record: null,
      candidate: { id: candidateId, name: 'Saldun' },
    });
    const other = await enqueue(draft('Nowhere else'));
    expect((await getCurationItem(testDb.db, other))?.candidate).toBeNull();
    // The candidate gone (merged away), the draft stays but names nothing.
    await testDb.db.delete(placeOpenDataSources).where(eq(placeOpenDataSources.id, row.id));
    expect((await getCurationItem(testDb.db, item.id))?.candidate).toBeNull();
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

describe('a drafted Seeding candidate draft (42)', () => {
  const VENUE = 'https://www.konoba.example/';
  const CONTACT = `${VENUE}kontakt/`;
  const OSM_URL = 'https://www.openstreetmap.org/node/42';
  const HOURS = [{ weekday: 1, opens: '12:00', closes: '23:00', validFrom: null, validTo: null }];
  const SEASONS = [{ fromMonth: 5, fromDay: 1, toMonth: 10, toDay: 15 }];
  const IMAGE = {
    url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Konoba.jpg',
    licence: 'CC BY-SA 4.0',
    attribution: 'A photographer',
    sourcePageUrl: 'https://commons.wikimedia.org/wiki/File:Konoba.jpg',
  };

  /** A ticked candidate with two rows and its draft item, drafted unless told otherwise. */
  async function candidateDraft(drafted = true) {
    const destination = await seedDestination(testDb.db);
    await upsertSourceRows(
      testDb.db,
      destination,
      [
        {
          source: 'osm',
          externalId: 'node/42',
          name: 'Konoba',
          location: { lat: 43.5168, lng: 16.2512 },
          placeCategory: 'restaurant',
          licence: 'ODbL-1.0',
          sourceUrl: OSM_URL,
          data: { tags: { website: VENUE } },
        },
        {
          source: 'overture',
          externalId: 'ov-42',
          name: 'Konoba',
          location: { lat: 43.51681, lng: 16.25121 },
          placeCategory: 'restaurant',
          licence: 'CDLA-Permissive-2.0',
          sourceUrl: null,
          data: {},
        },
      ],
      NOW,
    );
    await groupUnassigned(testDb.db, destination, NOW);
    const [row] = await testDb.db
      .select({ candidateId: placeOpenDataSources.candidateId })
      .from(placeOpenDataSources)
      .where(eq(placeOpenDataSources.destinationId, destination));
    const candidateId = row?.candidateId;
    if (!candidateId) throw new Error('no candidate');
    await draftCandidates(testDb.db, noopQueue, destination, [candidateId], adminId, NOW);
    const [item] = await testDb.db
      .select()
      .from(curationItems)
      .where(eq(curationItems.dedupeKey, `seeding-candidate:${candidateId}`));
    if (!item) throw new Error('no item');
    if (drafted) {
      const payload: CurationPayload = {
        kind: 'draft',
        candidateId,
        changes: {
          title: 'Konoba Trs',
          description: 'A family konoba.',
          phone: '+385 21 000 000',
          openingHours: HOURS,
          seasons: SEASONS,
          fieldSources: {
            title: VENUE,
            description: VENUE,
            phone: CONTACT,
            openingHours: CONTACT,
            seasons: CONTACT,
          },
        },
        place: {
          placeCategory: 'restaurant',
          location: { lat: 43.5168, lng: 16.2512 },
          locationSourceUrl: OSM_URL,
        },
        images: [IMAGE],
        drafting: { status: 'drafted', at: NOW.toISOString(), pages: [VENUE, CONTACT] },
      };
      await testDb.db.update(curationItems).set({ payload }).where(eq(curationItems.id, item.id));
    }
    return { destination, candidateId, itemId: item.id };
  }

  it('lists a drafted draft as drafted, and an undrafted one as not', async () => {
    const drafted = await candidateDraft();
    const waiting = await candidateDraft(false);
    expect((await getCurationItem(testDb.db, drafted.itemId))?.drafted).toBe(true);
    expect((await getCurationItem(testDb.db, waiting.itemId))?.drafted).toBe(false);
  });

  it('approve creates the place with its sources, hours, seasons and image, and retires the candidate', async () => {
    const { destination, candidateId, itemId } = await candidateDraft();
    const row = await approveCurationItem(deps, itemId, adminId, LATER);
    const recordId = row.recordId;
    if (!recordId) throw new Error('no record');
    const record = await recordOf(recordId);
    expect(record).toMatchObject({
      destinationId: destination,
      kind: 'place',
      title: 'Konoba Trs',
      description: 'A family konoba.',
      phone: '+385 21 000 000',
      placeCategory: 'restaurant',
      location: { x: 16.2512, y: 43.5168 },
      verifiedAt: LATER,
      verifiedBy: adminId,
    });
    expect(record.fieldSources).toEqual({
      title: VENUE,
      description: VENUE,
      phone: CONTACT,
      openingHours: CONTACT,
      seasons: CONTACT,
      location: OSM_URL,
    });
    const hours = await testDb.db
      .select()
      .from(catalogOpeningHours)
      .where(eq(catalogOpeningHours.recordId, recordId));
    expect(hours).toEqual([expect.objectContaining({ weekday: 1, opens: '12:00:00' })]);
    const seasons = await testDb.db
      .select()
      .from(catalogSeasons)
      .where(eq(catalogSeasons.recordId, recordId));
    expect(seasons).toEqual([expect.objectContaining(SEASONS[0])]);
    const images = await testDb.db
      .select()
      .from(placeImages)
      .where(eq(placeImages.recordId, recordId));
    expect(images).toEqual([expect.objectContaining({ ...IMAGE, source: 'wikimedia_commons' })]);
    const rows = await testDb.db
      .select()
      .from(placeOpenDataSources)
      .where(eq(placeOpenDataSources.destinationId, destination));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.recordId === recordId && r.candidateId === null)).toBe(true);
    expect(
      await testDb.db.select().from(seedingCandidates).where(eq(seedingCandidates.id, candidateId)),
    ).toEqual([]);
    expect(await getCurationItem(testDb.db, itemId)).toMatchObject({
      status: 'approved',
      record: { id: recordId, title: 'Konoba Trs' },
    });
  });

  it('approve refuses an undrafted candidate draft', async () => {
    const { itemId } = await candidateDraft(false);
    await rejects(approveCurationItem(deps, itemId, adminId, LATER), 'invalid-input');
  });

  it('edit creates the record unverified, and a later approve only verifies it', async () => {
    const { destination, itemId } = await candidateDraft();
    const { recordId } = await editCurationItem(deps, itemId, LATER);
    expect((await recordOf(recordId)).verifiedAt).toBeNull();
    await updateCatalogRecord(testDb.db, noopQueue, recordId, { title: 'Konoba Trš' }, LATER);
    const row = await approveCurationItem(deps, itemId, adminId, LATER);
    expect(row.recordId).toBe(recordId);
    expect(await recordOf(recordId)).toMatchObject({ title: 'Konoba Trš', verifiedAt: LATER });
    const records = await testDb.db
      .select()
      .from(catalogRecords)
      .where(eq(catalogRecords.destinationId, destination));
    expect(records).toHaveLength(1);
  });

  it('approving a refresh diff of hours replaces them and verifies the record', async () => {
    const recordId = await place('Konoba Hours');
    const id = await enqueue(
      {
        kind: 'refresh_diff',
        changes: { openingHours: HOURS, fieldSources: { openingHours: CONTACT } },
        previous: { openingHours: [] },
      },
      { recordId },
    );
    await approveCurationItem(deps, id, adminId, LATER);
    const hours = await testDb.db
      .select()
      .from(catalogOpeningHours)
      .where(eq(catalogOpeningHours.recordId, recordId));
    expect(hours).toHaveLength(1);
    const record = await recordOf(recordId);
    expect(record.verifiedAt).toEqual(LATER);
    expect(record.fieldSources).toMatchObject({ openingHours: CONTACT });
  });
});
