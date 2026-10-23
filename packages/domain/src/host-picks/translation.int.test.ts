import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { catalogRecords } from '../db/schema/catalog';
import { hostPlaces, hostPlaceTranslations } from '../db/schema/host-places';
import { QUEUES } from '../jobs/queue';
import { GUEST_LANGUAGES, type GuestLanguage } from '../property/vocabulary';
import {
  createTestDatabase,
  recordingQueue,
  seedDestination,
  seedGuestUnit,
  type TestDatabase,
} from '../testing';
import { type TranslationDeps, TranslationRuleError } from '../translation/job';
import type { ModelResult, TranslationModel } from '../translation/model';
import {
  needsTranslation,
  retryHostPlaceTranslation,
  runHostPlaceTranslation,
} from './translation';

let testDb: TestDatabase;
let propertyId: string;
let recordId: string;
const queue = recordingQueue();

beforeAll(async () => {
  testDb = await createTestDatabase();
  const destinationId = await seedDestination(testDb.db);
  ({ propertyId } = await seedGuestUnit(testDb.db));
  const [record] = await testDb.db
    .insert(catalogRecords)
    .values({
      destinationId,
      kind: 'place',
      title: 'Plaža Pantan',
      description: 'Pješčana plaža.',
      placeCategory: 'beach',
      location: { x: 16.27, y: 43.52 },
    })
    .returning();
  if (!record) throw new Error('no record');
  recordId = record.id;
});

afterAll(async () => {
  await testDb?.drop();
});

const deps = (): TranslationDeps => ({ db: testDb.db, queue, now: () => new Date() });

type Slot = { title: string; body: string };
const good = (language: string): Slot => ({
  title: `Konoba ${language}`,
  body: `Best fish ${language}, ask for Ante.`,
});

function output(slot: (l: string) => Slot): ModelResult {
  const translations = Object.fromEntries(GUEST_LANGUAGES.map((l) => [l, slot(l)])) as Record<
    GuestLanguage,
    Slot
  >;
  return { ok: true, output: { source_language: 'hr', translations } };
}

function scripted(...results: ModelResult[]) {
  const model: TranslationModel & { calls: number; sources: Slot[] } = {
    calls: 0,
    sources: [],
    async translate(source) {
      model.sources.push(source);
      const next = results[model.calls];
      model.calls += 1;
      if (!next) throw new Error('unexpected model call');
      return next;
    },
  };
  return model;
}

const addPlace = async () => {
  const [row] = await testDb.db
    .insert(hostPlaces)
    .values({
      propertyId,
      name: 'Konoba Ante',
      placeCategory: 'restaurant',
      location: { x: 16.25, y: 43.51 },
      note: 'Najbolja riba, pitajte Antu.',
    })
    .returning();
  if (!row) throw new Error('no host place');
  return row;
};

const rowOf = async (id: string) => {
  const [row] = await testDb.db.select().from(hostPlaces).where(eq(hostPlaces.id, id));
  if (!row) throw new Error('no host place');
  return row;
};

const translationsOf = (id: string, revision: number) =>
  testDb.db
    .select()
    .from(hostPlaceTranslations)
    .where(
      and(eq(hostPlaceTranslations.hostPlaceId, id), eq(hostPlaceTranslations.revision, revision)),
    );

describe('runHostPlaceTranslation', () => {
  it('publishes a host-added place in all seven languages', async () => {
    const row = await addPlace();
    const model = scripted(output(good));
    expect(
      await runHostPlaceTranslation({ ...deps(), model }, { hostPlaceId: row.id, revision: 1 }),
    ).toBe('published');
    expect(model.calls).toBe(1);
    const rows = await translationsOf(row.id, 1);
    expect(rows).toHaveLength(7);
    expect(rows.find((r) => r.language === 'de')).toMatchObject({
      name: 'Konoba de',
      note: 'Best fish de, ask for Ante.',
      origin: 'machine',
    });
    expect(rows.find((r) => r.language === 'hr')).toMatchObject({
      name: 'Konoba Ante',
      note: 'Najbolja riba, pitajte Antu.',
      origin: 'source',
    });
    expect(await rowOf(row.id)).toMatchObject({
      publishedRevision: 1,
      translationStatus: 'published',
      sourceLanguage: 'hr',
    });
  });

  it("sends a pick's record title for shape only and stores an empty name", async () => {
    const [pick] = await testDb.db
      .insert(hostPlaces)
      .values({ propertyId, catalogRecordId: recordId, note: 'Dođite rano ujutro.' })
      .returning();
    if (!pick) throw new Error('no pick');
    const model = scripted(output(good));
    expect(
      await runHostPlaceTranslation({ ...deps(), model }, { hostPlaceId: pick.id, revision: 1 }),
    ).toBe('published');
    expect(model.sources[0]).toEqual({ title: 'Plaža Pantan', body: 'Dođite rano ujutro.' });
    const rows = await translationsOf(pick.id, 1);
    expect(rows).toHaveLength(7);
    expect(rows.every((r) => r.name === '')).toBe(true);
    expect(rows.find((r) => r.language === 'fr')?.note).toBe('Best fish fr, ask for Ante.');
  });

  it('discards a stale revision without calling the model', async () => {
    const row = await addPlace();
    await testDb.db.update(hostPlaces).set({ revision: 2 }).where(eq(hostPlaces.id, row.id));
    const model = scripted();
    expect(
      await runHostPlaceTranslation({ ...deps(), model }, { hostPlaceId: row.id, revision: 1 }),
    ).toBe('discarded');
    expect(model.calls).toBe(0);
  });

  it('ends a model error as failed, and retry re-sends it', async () => {
    const row = await addPlace();
    const model = scripted({ ok: false, error: 'model-error', detail: 'boom' });
    expect(
      await runHostPlaceTranslation({ ...deps(), model }, { hostPlaceId: row.id, revision: 1 }),
    ).toBe('failed');
    expect(await rowOf(row.id)).toMatchObject({
      translationStatus: 'failed',
      translationError: 'model-error',
      publishedRevision: null,
    });

    const before = queue.jobs.length;
    await retryHostPlaceTranslation(deps(), row.id);
    expect(queue.jobs.slice(before)).toEqual([
      {
        name: QUEUES.translateHostPlace,
        data: { hostPlaceId: row.id, revision: 1 },
        id: undefined,
      },
    ]);
    expect((await rowOf(row.id)).translationStatus).toBe('pending');
    await expect(retryHostPlaceTranslation(deps(), row.id)).rejects.toBeInstanceOf(
      TranslationRuleError,
    );

    const again = scripted(output(good));
    expect(
      await runHostPlaceTranslation(
        { ...deps(), model: again },
        { hostPlaceId: row.id, revision: 1 },
      ),
    ).toBe('published');
    expect((await rowOf(row.id)).translationStatus).toBe('published');
    expect(await translationsOf(row.id, 1)).toHaveLength(7);
  });

  it('deletes older revisions when a newer one publishes', async () => {
    const row = await addPlace();
    await runHostPlaceTranslation(
      { ...deps(), model: scripted(output(good)) },
      { hostPlaceId: row.id, revision: 1 },
    );
    await testDb.db
      .update(hostPlaces)
      .set({ revision: 2, note: 'Nova bilješka.', translationStatus: 'pending' })
      .where(eq(hostPlaces.id, row.id));
    expect(
      await runHostPlaceTranslation(
        { ...deps(), model: scripted(output(good)) },
        { hostPlaceId: row.id, revision: 2 },
      ),
    ).toBe('published');
    expect(await translationsOf(row.id, 1)).toHaveLength(0);
    expect(await translationsOf(row.id, 2)).toHaveLength(7);
  });
});

describe('needsTranslation', () => {
  it('is false only for a pick without a note', () => {
    expect(needsTranslation({ name: null, note: null })).toBe(false);
    expect(needsTranslation({ name: null, note: 'x' })).toBe(true);
    expect(needsTranslation({ name: 'x', note: 'y' })).toBe(true);
  });
});
