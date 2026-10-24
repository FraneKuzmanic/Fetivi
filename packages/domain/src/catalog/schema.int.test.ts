import { eq, sql } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accounts } from '../db/schema/accounts';
import {
  catalogOpeningHours,
  catalogRecords,
  catalogSeasons,
  catalogTranslations,
  destinations,
  placeImages,
  placeOpenDataSources,
} from '../db/schema/catalog';
import { seedingCandidates } from '../db/schema/seeding';
import { createJobQueue, ensureQueues, type JobQueue, QUEUES } from '../jobs/queue';
import { createTestDatabase, type TestDatabase } from '../testing';
import {
  CatalogRuleError,
  createCatalogRecord,
  markVerified,
  type NewCatalogRecord,
  replaceOpeningHours,
  replacePlaceImages,
  replaceSeasons,
  updateCatalogRecord,
} from './store';

let testDb: TestDatabase;
let boss: PgBoss;
let queue: JobQueue;
let destinationId: string;
const NOW = new Date('2027-05-01T10:00:00Z');
const LOC = { x: 16.2475, y: 43.5161 };

const openDataRow = (link: {
  recordId?: string | null;
  candidateId?: string | null;
  externalId: string;
}) => ({
  destinationId,
  recordId: link.recordId ?? null,
  candidateId: link.candidateId ?? null,
  source: 'osm' as const,
  externalId: link.externalId,
  licence: 'ODbL-1.0',
  name: 'Kamerlengo',
  location: LOC,
  placeCategory: 'sight' as const,
  data: { tags: { name: 'Kamerlengo', opening_hours: 'Mo-Su 09:00-21:00' } },
  fetchedAt: NOW,
});

beforeAll(async () => {
  testDb = await createTestDatabase();
  boss = new PgBoss({ connectionString: testDb.url, supervise: false, schedule: false });
  boss.on('error', console.error);
  await boss.start();
  await ensureQueues(boss);
  queue = createJobQueue(boss);
  destinationId = await newDestination('Trogir');
});

afterAll(async () => {
  await boss?.stop({ graceful: false, timeout: 1000 });
  await testDb?.drop();
});

async function newDestination(name: string) {
  const [d] = await testDb.db
    .insert(destinations)
    .values({ name, centre: { x: 16.2513, y: 43.5169 }, radiusM: 15_000 })
    .returning();
  if (!d) throw new Error('no destination');
  return d.id;
}

const text = { title: 'Kamerlengo Fortress', description: 'A fortress.' };
const place = (extra: Partial<NewCatalogRecord> = {}): NewCatalogRecord => ({
  destinationId,
  kind: 'place',
  placeCategory: 'sight',
  location: LOC,
  ...text,
  ...extra,
});
const create = (values: NewCatalogRecord) => createCatalogRecord(testDb.db, queue, values, NOW);
const invalid = new CatalogRuleError('invalid-input');

describe('per-kind checks', () => {
  const start = new Date('2027-07-01T18:00:00Z');
  it.each<[string, NewCatalogRecord]>([
    ['a place without a category', place({ placeCategory: null })],
    ['a place without a location', place({ location: null })],
    ['an event without ends_at', { destinationId: '', kind: 'event', ...text, startsAt: start }],
    [
      'an event ending at its start',
      { destinationId: '', kind: 'event', ...text, startsAt: start, endsAt: start },
    ],
    ['a transport note without a mode', { destinationId: '', kind: 'transport_note', ...text }],
    ['a day trip of 0 minutes', { destinationId: '', kind: 'day_trip', ...text, travelMinutes: 0 }],
    [
      'an event with a place category',
      {
        destinationId: '',
        kind: 'event',
        ...text,
        startsAt: start,
        endsAt: new Date(start.getTime() + 3_600_000),
        placeCategory: 'sight',
      },
    ],
  ])('rejects %s', async (_name, values) => {
    await expect(create({ ...values, destinationId })).rejects.toEqual(invalid);
  });
});

describe('deletion', () => {
  it('cascades every child row of a record', async () => {
    const record = await create(place());
    await replaceSeasons(
      testDb.db,
      record.id,
      [{ fromMonth: 4, fromDay: 1, toMonth: 10, toDay: 31 }],
      NOW,
    );
    await replaceOpeningHours(
      testDb.db,
      record.id,
      [{ weekday: 1, opens: '09:00', closes: '17:00', validFrom: null, validTo: null }],
      NOW,
    );
    await replacePlaceImages(
      testDb.db,
      record.id,
      [
        {
          url: 'https://example.com/a.jpg',
          source: 'own_photo',
          licence: null,
          attribution: null,
          sourcePageUrl: null,
        },
      ],
      NOW,
    );
    await testDb.db.insert(catalogTranslations).values({
      recordId: record.id,
      revision: 1,
      language: 'en',
      title: 'x',
      body: 'y',
      origin: 'machine',
    });
    const [openData] = await testDb.db
      .insert(placeOpenDataSources)
      .values(openDataRow({ recordId: record.id, externalId: 'node/1' }))
      .returning();
    if (!openData) throw new Error('no open-data row');

    await testDb.db.delete(catalogRecords).where(eq(catalogRecords.id, record.id));
    for (const table of [catalogSeasons, catalogOpeningHours, placeImages, catalogTranslations]) {
      const rows = await testDb.db.select().from(table).where(eq(table.recordId, record.id));
      expect(rows).toHaveLength(0);
    }
    // Open-data rows return to the seeding pool instead of disappearing.
    const [kept] = await testDb.db
      .select()
      .from(placeOpenDataSources)
      .where(eq(placeOpenDataSources.id, openData.id));
    expect(kept?.recordId).toBeNull();
  });

  it('refuses to delete a destination that has records', async () => {
    const id = await newDestination('Split');
    await create(place({ destinationId: id }));
    await expect(testDb.db.delete(destinations).where(eq(destinations.id, id))).rejects.toThrow();
  });
});

describe('updateCatalogRecord', () => {
  const jobs = async (recordId: string) => {
    const { rows } = await testDb.db.execute<{ revision: number }>(
      sql`select (data->>'revision')::int as revision from pgboss.job where name = ${QUEUES.translateCatalogRecord} and data->>'recordId' = ${recordId} order by 1`,
    );
    return rows.map((r) => r.revision);
  };

  it('bumps the revision on a text change only, enqueuing each revision once', async () => {
    const record = await create(place());
    const phoned = await updateCatalogRecord(
      testDb.db,
      queue,
      record.id,
      { phone: '+385 21 000' },
      NOW,
    );
    expect(phoned.revision).toBe(1);
    await testDb.db
      .update(catalogRecords)
      .set({ translationStatus: 'failed', translationError: 'model-error' })
      .where(eq(catalogRecords.id, record.id));
    const renamed = await updateCatalogRecord(
      testDb.db,
      queue,
      record.id,
      { title: 'Kamerlengo' },
      NOW,
    );
    expect(renamed).toMatchObject({
      revision: 2,
      translationStatus: 'pending',
      translationError: null,
      sourceLanguage: null,
    });
    expect(await jobs(record.id)).toEqual([1, 2]);
  });

  it('reports a missing record as not-found', async () => {
    await expect(
      updateCatalogRecord(testDb.db, queue, '00000000-0000-4000-8000-000000000000', {}, NOW),
    ).rejects.toEqual(new CatalogRuleError('not-found'));
  });
});

describe('row replacement by kind', () => {
  const event = () =>
    create({
      destinationId,
      kind: 'event',
      ...text,
      startsAt: new Date('2027-07-01T18:00:00Z'),
      endsAt: new Date('2027-07-01T21:00:00Z'),
    });

  it('refuses hours and seasons on an event, and images on a day trip', async () => {
    const e = await event();
    await expect(
      replaceOpeningHours(
        testDb.db,
        e.id,
        [{ weekday: 1, opens: '09:00', closes: '17:00', validFrom: null, validTo: null }],
        NOW,
      ),
    ).rejects.toEqual(invalid);
    await expect(
      replaceSeasons(testDb.db, e.id, [{ fromMonth: 1, fromDay: 1, toMonth: 2, toDay: 1 }], NOW),
    ).rejects.toEqual(invalid);
    const trip = await create({ destinationId, kind: 'day_trip', ...text, travelMinutes: 60 });
    await expect(replacePlaceImages(testDb.db, trip.id, [], NOW)).rejects.toEqual(invalid);
  });

  it('refuses a Wikimedia image without a licence in the database', async () => {
    const record = await create(place());
    await expect(
      replacePlaceImages(
        testDb.db,
        record.id,
        [
          {
            url: 'https://upload.wikimedia.org/x.jpg',
            source: 'wikimedia_commons',
            licence: null,
            attribution: 'Someone',
            sourcePageUrl: 'https://commons.wikimedia.org/wiki/File:X.jpg',
          },
        ],
        NOW,
      ),
    ).rejects.toEqual(invalid);
  });
});

describe('open-data separation', () => {
  it('keeps open-data fields in their own table, one row per destination, source and id', async () => {
    const record = await create(place());
    const osm = openDataRow({ recordId: record.id, externalId: 'node/123' });
    await testDb.db.insert(placeOpenDataSources).values(osm);
    const [after] = await testDb.db
      .select()
      .from(catalogRecords)
      .where(eq(catalogRecords.id, record.id));
    expect(after).toMatchObject(text);
    await expect(
      testDb.db.insert(placeOpenDataSources).values({ ...osm, recordId: null }),
    ).rejects.toThrow();
  });

  it('refuses a row linked to both a record and a candidate', async () => {
    const record = await create(place());
    const [candidate] = await testDb.db
      .insert(seedingCandidates)
      .values({ destinationId })
      .returning();
    if (!candidate) throw new Error('no candidate');
    await expect(
      testDb.db
        .insert(placeOpenDataSources)
        .values(
          openDataRow({ recordId: record.id, candidateId: candidate.id, externalId: 'node/9' }),
        ),
    ).rejects.toThrow();
  });
});

describe('markVerified', () => {
  it('stamps verified_at and verified_by, and moves it on again', async () => {
    const [admin] = await testDb.db
      .insert(accounts)
      .values({ email: 'admin@example.test', passwordHash: 'x', role: 'admin' })
      .returning();
    if (!admin) throw new Error('no admin');
    const record = await create(place());
    const first = await markVerified(testDb.db, record.id, admin.id, NOW);
    expect(first).toMatchObject({ verifiedAt: NOW, verifiedBy: admin.id });
    const later = new Date(NOW.getTime() + 86_400_000);
    expect((await markVerified(testDb.db, record.id, null, later)).verifiedAt).toEqual(later);
  });
});
