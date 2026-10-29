import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCatalogTranslation } from '../catalog/translation';
import { catalogRecords, catalogTranslations } from '../db/schema/catalog';
import { catalogEmbeddings, hostPlaceEmbeddings } from '../db/schema/embeddings';
import { hostPlaces, hostPlaceTranslations } from '../db/schema/host-places';
import { runHostPlaceTranslation } from '../host-picks/translation';
import { QUEUES, uuidFrom } from '../jobs/queue';
import { GUEST_LANGUAGES, type GuestLanguage } from '../property/vocabulary';
import {
  createTestDatabase,
  fakeEmbedder,
  publishHostPlace,
  recordingQueue,
  seedDestination,
  seedGuestUnit,
  type TestDatabase,
  unavailableEmbedder,
} from '../testing';
import type { ModelResult, TranslationModel } from '../translation/model';
import {
  backfillEmbeddings,
  catalogSearchTexts,
  hostPlaceSearchTexts,
  runCatalogEmbedding,
  runHostPlaceEmbedding,
} from './store';
import { type Embedder, EmbeddingUnavailableError } from './voyage';

let testDb: TestDatabase;
let destinationId: string;
let propertyId: string;
const queue = recordingQueue();

beforeAll(async () => {
  testDb = await createTestDatabase();
  destinationId = await seedDestination(testDb.db);
  ({ propertyId } = await seedGuestUnit(testDb.db));
});

afterAll(async () => {
  await testDb?.drop();
});

function translated(tag: string): ModelResult {
  const translations = Object.fromEntries(
    GUEST_LANGUAGES.map((l) => [l, { title: `Konoba Mala ${l}${tag}`, body: `Grilled fish ${l}` }]),
  ) as Record<GuestLanguage, { title: string; body: string }>;
  return { ok: true, output: { source_language: 'hr', title_language: 'hr', translations } };
}

const model = (result: ModelResult): TranslationModel => ({ translate: async () => result });

const translationDeps = (result: ModelResult) => ({
  db: testDb.db,
  queue,
  now: () => new Date(),
  model: model(result),
});

const addRecord = async () => {
  const [record] = await testDb.db
    .insert(catalogRecords)
    .values({
      destinationId,
      kind: 'place',
      title: 'Konoba Mala',
      description: 'Riba s gradela.',
      placeCategory: 'restaurant',
      location: { x: 16.25, y: 43.51 },
    })
    .returning();
  if (!record) throw new Error('no record');
  return record;
};

/** A record published at revision 1 through the translation job. */
const publishedRecord = async () => {
  const record = await addRecord();
  expect(
    await runCatalogTranslation(translationDeps(translated('')), {
      recordId: record.id,
      revision: 1,
    }),
  ).toBe('published');
  return record;
};

const catalogVectors = (recordId: string) =>
  testDb.db.select().from(catalogEmbeddings).where(eq(catalogEmbeddings.recordId, recordId));

const failing = (error: Error): Embedder => ({
  model: 'fake-1',
  embed: async () => {
    throw error;
  },
});

describe('publishing enqueues embedding', () => {
  it('sends embed-catalog-record with the published revision', async () => {
    const record = await publishedRecord();
    expect(queue.jobs).toContainEqual({
      name: QUEUES.embedCatalogRecord,
      data: { recordId: record.id, revision: 1 },
      id: uuidFrom(`embed:catalog:${record.id}:1`),
    });
  });

  it('sends embed-host-place for a host-added place, not for a pick', async () => {
    const [added] = await testDb.db
      .insert(hostPlaces)
      .values({
        propertyId,
        name: 'Konoba Ante',
        placeCategory: 'restaurant',
        location: { x: 16.25, y: 43.51 },
        note: 'Najbolja riba.',
      })
      .returning();
    if (!added) throw new Error('no host place');
    expect(
      await runHostPlaceTranslation(translationDeps(translated('')), {
        hostPlaceId: added.id,
        revision: 1,
      }),
    ).toBe('published');
    expect(queue.jobs).toContainEqual({
      name: QUEUES.embedHostPlace,
      data: { hostPlaceId: added.id, revision: 1 },
      id: uuidFrom(`embed:host-place:${added.id}:1`),
    });

    const record = await addRecord();
    const [pick] = await testDb.db
      .insert(hostPlaces)
      .values({ propertyId, catalogRecordId: record.id, note: 'Go early.' })
      .returning();
    if (!pick) throw new Error('no pick');
    expect(
      await runHostPlaceTranslation(translationDeps(translated('')), {
        hostPlaceId: pick.id,
        revision: 1,
      }),
    ).toBe('published');
    expect(queue.jobs.filter((j) => j.name === QUEUES.embedHostPlace)).not.toContainEqual(
      expect.objectContaining({ data: { hostPlaceId: pick.id, revision: 1 } }),
    );
  });
});

describe('runCatalogEmbedding', () => {
  it('embeds each language once, as a document', async () => {
    const record = await publishedRecord();
    const embedder = fakeEmbedder();
    const job = { recordId: record.id, revision: 1 };

    const first = await runCatalogEmbedding({ db: testDb.db, embedder }, job);
    expect(first.result).toBe('embedded');
    expect(first.tokens).toBeGreaterThan(0);
    expect(embedder.calls).toHaveLength(1);
    expect(embedder.calls[0]?.input).toBe('document');
    expect(embedder.calls[0]?.texts).toContain('Konoba Mala de\n\nGrilled fish de');

    const rows = await catalogVectors(record.id);
    expect(rows).toHaveLength(GUEST_LANGUAGES.length);
    expect(rows.every((r) => r.model === 'fake-1' && r.revision === 1)).toBe(true);
    // real[] comes back from node-postgres as numbers.
    expect(rows[0]?.vector).toHaveLength(64);
    expect(typeof rows[0]?.vector[0]).toBe('number');

    expect(await runCatalogEmbedding({ db: testDb.db, embedder }, job)).toEqual({
      result: 'nothing-to-do',
      tokens: 0,
    });
    expect(embedder.calls).toHaveLength(1);
  });

  it('embeds again for another model', async () => {
    const record = await publishedRecord();
    const job = { recordId: record.id, revision: 1 };
    await runCatalogEmbedding({ db: testDb.db, embedder: fakeEmbedder() }, job);
    const other = { ...fakeEmbedder(), model: 'fake-2' };
    expect((await runCatalogEmbedding({ db: testDb.db, embedder: other }, job)).result).toBe(
      'embedded',
    );
    const models = (await catalogVectors(record.id)).map((r) => r.model);
    expect(models.filter((m) => m === 'fake-2')).toHaveLength(GUEST_LANGUAGES.length);
    expect(models.filter((m) => m === 'fake-1')).toHaveLength(GUEST_LANGUAGES.length);
  });

  it('discards a revision that is not the published one', async () => {
    const record = await publishedRecord();
    const embedder = fakeEmbedder();
    expect(
      await runCatalogEmbedding({ db: testDb.db, embedder }, { recordId: record.id, revision: 2 }),
    ).toEqual({ result: 'discarded', tokens: 0 });
    expect(embedder.calls).toHaveLength(0);
  });

  it('ends quietly without a key and throws on an outage', async () => {
    const record = await publishedRecord();
    const job = { recordId: record.id, revision: 1 };
    expect(
      await runCatalogEmbedding({ db: testDb.db, embedder: unavailableEmbedder() }, job),
    ).toEqual({ result: 'not-configured', tokens: 0 });
    expect(await catalogVectors(record.id)).toEqual([]);
    await expect(
      runCatalogEmbedding(
        { db: testDb.db, embedder: failing(new EmbeddingUnavailableError('status 503')) },
        job,
      ),
    ).rejects.toThrow('status 503');
  });

  it("drops the old revision's vectors when a new revision publishes", async () => {
    const record = await publishedRecord();
    await runCatalogEmbedding(
      { db: testDb.db, embedder: fakeEmbedder() },
      { recordId: record.id, revision: 1 },
    );
    await testDb.db
      .update(catalogRecords)
      .set({ revision: 2, translationStatus: 'pending' })
      .where(eq(catalogRecords.id, record.id));
    expect(
      await runCatalogTranslation(translationDeps(translated(' v2')), {
        recordId: record.id,
        revision: 2,
      }),
    ).toBe('published');
    expect(await catalogVectors(record.id)).toEqual([]);
    expect(queue.jobs).toContainEqual(
      expect.objectContaining({
        name: QUEUES.embedCatalogRecord,
        data: { recordId: record.id, revision: 2 },
      }),
    );
  });
});

describe('runHostPlaceEmbedding', () => {
  it('embeds a host-added place and skips a pick', async () => {
    const [added] = await testDb.db
      .insert(hostPlaces)
      .values({
        propertyId,
        name: 'Konoba Ante',
        placeCategory: 'restaurant',
        location: { x: 16.25, y: 43.51 },
        note: 'Best grilled fish.',
      })
      .returning();
    if (!added) throw new Error('no host place');
    await publishHostPlace(testDb.db, added.id);
    const embedder = fakeEmbedder();
    const job = { hostPlaceId: added.id, revision: 1 };
    expect((await runHostPlaceEmbedding({ db: testDb.db, embedder }, job)).result).toBe('embedded');
    expect(embedder.calls[0]?.texts).toContain('[de] Konoba Ante\n\n[de] Best grilled fish.');
    const rows = await testDb.db
      .select()
      .from(hostPlaceEmbeddings)
      .where(eq(hostPlaceEmbeddings.hostPlaceId, added.id));
    expect(rows).toHaveLength(GUEST_LANGUAGES.length);
    expect((await runHostPlaceEmbedding({ db: testDb.db, embedder }, job)).result).toBe(
      'nothing-to-do',
    );

    const record = await addRecord();
    const [pick] = await testDb.db
      .insert(hostPlaces)
      .values({ propertyId, catalogRecordId: record.id, note: 'Go early.' })
      .returning();
    if (!pick) throw new Error('no pick');
    await publishHostPlace(testDb.db, pick.id);
    expect(
      await runHostPlaceEmbedding(
        { db: testDb.db, embedder },
        { hostPlaceId: pick.id, revision: 1 },
      ),
    ).toEqual({ result: 'nothing-to-do', tokens: 0 });
  });
});

describe('backfillEmbeddings', () => {
  const missing = async (model: string) => {
    const [catalog] = await testDb.db
      .select({ n: sql<number>`count(*)::int` })
      .from(catalogTranslations)
      .innerJoin(
        catalogRecords,
        and(
          eq(catalogRecords.id, catalogTranslations.recordId),
          eq(catalogRecords.publishedRevision, catalogTranslations.revision),
        ),
      )
      .where(
        sql`not exists (select 1 from ${catalogEmbeddings} e where e.record_id = ${catalogTranslations.recordId} and e.revision = ${catalogTranslations.revision} and e.language = ${catalogTranslations.language} and e.model = ${model})`,
      );
    const [host] = await testDb.db
      .select({ n: sql<number>`count(*)::int` })
      .from(hostPlaceTranslations)
      .innerJoin(
        hostPlaces,
        and(
          eq(hostPlaces.id, hostPlaceTranslations.hostPlaceId),
          eq(hostPlaces.publishedRevision, hostPlaceTranslations.revision),
        ),
      )
      .where(
        sql`${hostPlaces.name} is not null and not exists (select 1 from ${hostPlaceEmbeddings} e where e.host_place_id = ${hostPlaceTranslations.hostPlaceId} and e.revision = ${hostPlaceTranslations.revision} and e.language = ${hostPlaceTranslations.language} and e.model = ${model})`,
      );
    return { catalog: catalog?.n ?? 0, hostPlaces: host?.n ?? 0 };
  };

  it('embeds every published row missing a vector, once', async () => {
    await publishedRecord();
    const embedder = fakeEmbedder();
    const before = await missing(embedder.model);
    expect(before.catalog).toBeGreaterThan(0);

    const first = await backfillEmbeddings({ db: testDb.db, embedder });
    expect(first).toMatchObject(before);
    expect(first.tokens).toBeGreaterThan(0);
    expect(await missing(embedder.model)).toEqual({ catalog: 0, hostPlaces: 0 });

    expect(await backfillEmbeddings({ db: testDb.db, embedder })).toEqual({
      catalog: 0,
      hostPlaces: 0,
      tokens: 0,
    });
  });
});

describe('search texts', () => {
  it('reads published texts and the current model vectors only', async () => {
    const record = await publishedRecord();
    await runCatalogEmbedding(
      { db: testDb.db, embedder: { ...fakeEmbedder(), model: 'fake-9' } },
      { recordId: record.id, revision: 1 },
    );
    const map = await catalogSearchTexts(testDb.db, [record.id], 'fake-9');
    const texts = map.get(record.id);
    expect(texts?.titles).toHaveLength(GUEST_LANGUAGES.length);
    expect(texts?.texts).toContain('Grilled fish de');
    expect(texts?.vectors).toHaveLength(GUEST_LANGUAGES.length);
    expect(
      (await catalogSearchTexts(testDb.db, [record.id], 'other')).get(record.id)?.vectors,
    ).toEqual([]);
    expect((await hostPlaceSearchTexts(testDb.db, [], 'fake-9')).size).toBe(0);
  });
});
