import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../db/client';
import { fieldTexts, fieldTextTranslations } from '../db/schema/field-texts';
import { properties } from '../db/schema/properties';
import { type JobQueue, QUEUES } from '../jobs/queue';
import { createTestDatabase, recordingQueue, seedGuestUnit, type TestDatabase } from '../testing';
import { type TranslationDeps, TranslationRuleError } from '../translation/job';
import type { ModelResult, TranslationModel } from '../translation/model';
import {
  backfillFieldTexts,
  type FieldOwner,
  fieldTranslationStatuses,
  retryFieldTextTranslation,
  runFieldTextTranslation,
  syncAmenityNoteTexts,
  syncFieldTexts,
} from './field-texts';
import { goLiveCheck, wizardFacts } from './go-live';
import { loadEffectiveUnit } from './load';
import { GUEST_LANGUAGES, type GuestLanguage } from './vocabulary';

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb?.drop();
});

type Slot = { title: string; body: string };
const good = (language: string): Slot => ({
  title: `Label ${language}`,
  body: `Gate text ${language}.`,
});

function output(slot: (l: string) => Slot): ModelResult {
  const translations = Object.fromEntries(GUEST_LANGUAGES.map((l) => [l, slot(l)])) as Record<
    GuestLanguage,
    Slot
  >;
  return { ok: true, output: { source_language: 'hr', title_language: 'hr', translations } };
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

const core = (accessInstructions: string | null) => ({
  accessInstructions,
  parkingNotes: null,
  houseRulesNotes: null,
});

const sync = (queue: JobQueue, owner: FieldOwner, value: string | null) =>
  testDb.db.transaction((tx) => syncFieldTexts(tx, queue, owner, core(value), new Date()));

const textsOf = (db: Db, owner: FieldOwner) =>
  db
    .select()
    .from(fieldTexts)
    .where(
      'propertyId' in owner
        ? eq(fieldTexts.propertyId, owner.propertyId)
        : eq(fieldTexts.unitId, owner.unitId),
    );

const translationsOf = (id: string, revision?: number) =>
  testDb.db
    .select()
    .from(fieldTextTranslations)
    .where(
      and(
        eq(fieldTextTranslations.fieldTextId, id),
        revision === undefined ? undefined : eq(fieldTextTranslations.revision, revision),
      ),
    );

const only = async (owner: FieldOwner) => {
  const rows = await textsOf(testDb.db, owner);
  expect(rows).toHaveLength(1);
  return rows[0] as NonNullable<(typeof rows)[0]>;
};

const deps = (queue: JobQueue): TranslationDeps => ({
  db: testDb.db,
  queue,
  now: () => new Date(),
});

describe('field text translation', () => {
  it('enqueues on save and publishes all seven languages, storing only the body', async () => {
    const { propertyId } = await seedGuestUnit(testDb.db);
    const owner = { propertyId };
    const queue = recordingQueue();
    expect(await sync(queue, owner, 'Uzmite plava vrata.')).toBe(1);
    const row = await only(owner);
    expect(row).toMatchObject({
      kind: 'access_instructions',
      revision: 1,
      translationStatus: 'pending',
    });
    expect(queue.jobs).toEqual([
      expect.objectContaining({
        name: QUEUES.translateFieldText,
        data: { fieldTextId: row.id, revision: 1 },
      }),
    ]);

    const model = scripted(output(good));
    expect(
      await runFieldTextTranslation(
        { ...deps(queue), model },
        { fieldTextId: row.id, revision: 1 },
      ),
    ).toBe('published');
    expect(model.sources[0]).toEqual({ title: 'Access instructions', body: 'Uzmite plava vrata.' });
    const rows = await translationsOf(row.id, 1);
    expect(rows).toHaveLength(7);
    expect(rows.find((r) => r.language === 'hr')).toMatchObject({
      text: 'Uzmite plava vrata.',
      origin: 'source',
    });
    expect(rows.find((r) => r.language === 'de')).toMatchObject({
      text: 'Gate text de.',
      origin: 'machine',
    });
    expect(await only(owner)).toMatchObject({
      translationStatus: 'published',
      sourceLanguage: 'hr',
    });
    expect(await fieldTranslationStatuses(testDb.db, owner)).toEqual([
      { id: row.id, field: 'accessInstructions', amenity: null, status: 'published', error: null },
    ]);

    // The same value again enqueues nothing.
    expect(await sync(queue, owner, 'Uzmite plava vrata.')).toBe(0);
    expect(queue.jobs).toHaveLength(1);
  });

  it('discards a job whose revision moved while it was pending', async () => {
    const { propertyId } = await seedGuestUnit(testDb.db);
    const owner = { propertyId };
    const queue = recordingQueue();
    await sync(queue, owner, 'Prva verzija.');
    await sync(queue, owner, 'Druga verzija.');
    const row = await only(owner);
    expect(row).toMatchObject({ revision: 2, source: 'Druga verzija.' });
    expect(queue.jobs.map((j) => j.data)).toEqual([
      { fieldTextId: row.id, revision: 1 },
      { fieldTextId: row.id, revision: 2 },
    ]);
    const model = scripted(output(good));
    expect(
      await runFieldTextTranslation(
        { ...deps(queue), model },
        { fieldTextId: row.id, revision: 1 },
      ),
    ).toBe('discarded');
    expect(model.calls).toBe(0);
    expect(await translationsOf(row.id, 1)).toHaveLength(0);
  });

  it('drops the old translations when a published field is edited', async () => {
    const { propertyId } = await seedGuestUnit(testDb.db);
    const owner = { propertyId };
    const queue = recordingQueue();
    await sync(queue, owner, 'Stari tekst.');
    const row = await only(owner);
    await runFieldTextTranslation(
      { ...deps(queue), model: scripted(output(good)) },
      { fieldTextId: row.id, revision: 1 },
    );
    expect(await translationsOf(row.id)).toHaveLength(7);
    await sync(queue, owner, 'Novi tekst.');
    expect(await only(owner)).toMatchObject({
      source: 'Novi tekst.',
      revision: 2,
      translationStatus: 'pending',
      sourceLanguage: null,
    });
    expect(await translationsOf(row.id)).toHaveLength(0);
  });

  it('deletes a cleared field, and its stale job is discarded', async () => {
    const { propertyId } = await seedGuestUnit(testDb.db);
    const owner = { propertyId };
    const queue = recordingQueue();
    await sync(queue, owner, 'Tekst.');
    const row = await only(owner);
    await sync(queue, owner, '   ');
    expect(await textsOf(testDb.db, owner)).toHaveLength(0);
    expect(
      await runFieldTextTranslation(
        { ...deps(queue), model: scripted() },
        { fieldTextId: row.id, revision: 1 },
      ),
    ).toBe('discarded');
  });

  it('marks a model error failed, and retry sends a fresh job', async () => {
    const { propertyId } = await seedGuestUnit(testDb.db);
    const owner = { propertyId };
    const queue = recordingQueue();
    await sync(queue, owner, 'Tekst.');
    const row = await only(owner);
    await expect(retryFieldTextTranslation(deps(queue), row.id)).rejects.toEqual(
      new TranslationRuleError('translation-not-failed'),
    );
    expect(
      await runFieldTextTranslation(
        {
          ...deps(queue),
          model: scripted({ ok: false, error: 'model-error', detail: 'scripted' }),
        },
        { fieldTextId: row.id, revision: 1 },
      ),
    ).toBe('failed');
    expect(await only(owner)).toMatchObject({
      translationStatus: 'failed',
      translationError: 'model-error',
    });
    await retryFieldTextTranslation(deps(queue), row.id);
    expect(await only(owner)).toMatchObject({
      translationStatus: 'pending',
      translationError: null,
    });
    expect(queue.jobs).toHaveLength(2);
    expect(queue.jobs[1]).toMatchObject({ id: undefined, data: { fieldTextId: row.id } });
  });

  it('fails with structure-mismatch when one language never passes, keeping six', async () => {
    const { propertyId } = await seedGuestUnit(testDb.db);
    const owner = { propertyId };
    const queue = recordingQueue();
    await sync(queue, owner, 'Tekst.');
    const row = await only(owner);
    const bad = (l: string): Slot =>
      l === 'fr' ? { title: 'x', body: 'Gate {{code}}.' } : good(l);
    expect(
      await runFieldTextTranslation(
        { ...deps(queue), model: scripted(output(bad), output(bad)) },
        { fieldTextId: row.id, revision: 1 },
      ),
    ).toBe('failed');
    expect(await only(owner)).toMatchObject({
      translationStatus: 'failed',
      translationError: 'structure-mismatch',
    });
    expect(await translationsOf(row.id, 1)).toHaveLength(6);
  });

  it('keeps a unit override apart from the property, and syncs amenity notes', async () => {
    const { propertyId, unitId } = await seedGuestUnit(testDb.db);
    const queue = recordingQueue();
    await sync(queue, { propertyId }, 'Isti tekst.');
    await sync(queue, { unitId }, 'Isti tekst.');
    expect((await only({ propertyId })).propertyId).toBe(propertyId);
    expect((await only({ unitId })).unitId).toBe(unitId);

    const now = new Date();
    const notes = (list: Parameters<typeof syncAmenityNoteTexts>[3]) =>
      testDb.db.transaction((tx) => syncAmenityNoteTexts(tx, queue, { unitId }, list, now));
    expect(
      await notes([
        { amenity: 'pool', note: 'Do 20h.' },
        { amenity: 'wifi', note: null },
        { amenity: 'tv', note: 'Netflix.' },
      ]),
    ).toBe(2);
    const amenityRows = async () =>
      (await textsOf(testDb.db, { unitId }))
        .filter((r) => r.kind === 'amenity_note')
        .map((r) => r.amenity)
        .sort();
    expect(await amenityRows()).toEqual(['pool', 'tv']);
    // tv removed, pool unchanged: nothing enqueued, tv's row deleted.
    expect(await notes([{ amenity: 'pool', note: 'Do 20h.' }])).toBe(0);
    expect(await amenityRows()).toEqual(['pool']);
    expect(await notes([])).toBe(0);
    expect(await amenityRows()).toEqual([]);
  });

  it('backfills values written straight to the columns, once', async () => {
    const { propertyId, unitId, secrets } = await seedGuestUnit(testDb.db);
    await testDb.db
      .update(properties)
      .set({ parkingNotes: 'Parking iza zgrade.' })
      .where(eq(properties.id, propertyId));
    const queue = recordingQueue();
    expect(await backfillFieldTexts(testDb.db, queue, new Date())).toBeGreaterThanOrEqual(2);
    expect(await only({ propertyId })).toMatchObject({
      kind: 'parking_notes',
      source: 'Parking iza zgrade.',
    });
    expect(await only({ unitId })).toMatchObject({
      kind: 'access_instructions',
      source: secrets.accessInstructions,
    });
    const again = recordingQueue();
    expect(await backfillFieldTexts(testDb.db, again, new Date())).toBe(0);
    expect(again.jobs).toHaveLength(0);
  });

  it('does not make go-live wait for a pending field translation (AC 5)', async () => {
    const { unitId } = await seedGuestUnit(testDb.db);
    const queue = recordingQueue();
    await sync(queue, { unitId }, 'Novo.');
    expect((await only({ unitId })).translationStatus).toBe('pending');
    const effective = await loadEffectiveUnit(testDb.db, unitId);
    if (!effective) throw new Error('no unit');
    expect(goLiveCheck(wizardFacts(effective)).missing).not.toContain('translations');
  });
});
