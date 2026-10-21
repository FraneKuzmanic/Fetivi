import { and, eq } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accounts } from '../db/schema/accounts';
import { blockMedia } from '../db/schema/block-media';
import { infoBlocks, unitHiddenBlocks } from '../db/schema/info-blocks';
import { properties, units } from '../db/schema/properties';
import { blockTranslations } from '../db/schema/translations';
import { createJobQueue, EVENTS, ensureQueues, type JobQueue, QUEUES } from '../jobs/queue';
import { GUEST_LANGUAGES, type GuestLanguage } from '../property/vocabulary';
import { createTestDatabase, type TestDatabase } from '../testing';
import {
  correctTranslation,
  listTranslations,
  retryTranslation,
  runTranslation,
  type TranslationDeps,
  TranslationRuleError,
  translationsDone,
} from './job';
import type { ModelResult, TranslationModel } from './model';

let testDb: TestDatabase;
let boss: PgBoss;
let queue: JobQueue;
const EVENT_QUEUE = 'test-projection';

beforeAll(async () => {
  testDb = await createTestDatabase();
  boss = new PgBoss({ connectionString: testDb.url, supervise: false, schedule: false });
  boss.on('error', console.error);
  await boss.start();
  await ensureQueues(boss);
  await boss.createQueue(EVENT_QUEUE);
  await boss.subscribe(EVENTS.unitProjectionInvalidated, EVENT_QUEUE);
  queue = createJobQueue(boss);
});

afterAll(async () => {
  await boss?.stop({ graceful: false, timeout: 1000 });
  await testDb?.drop();
});

const deps = (): TranslationDeps => ({ db: testDb.db, queue, now: () => new Date() });

const SOURCE = {
  title: 'Parkiranje',
  body: '## Parking\n\n1. Vozite do vrata.\n2. Unesite {{gate_code}}.\n\nKarta: https://maps.example.com/p',
};

/** A translation of SOURCE that keeps its structure. */
const good = (language: string, tag = '') => ({
  title: `Parking ${language}${tag}`,
  body: `## Parking ${language}${tag}\n\n1. Drive.\n2. Enter {{gate_code}}.\n\nMap: https://maps.example.com/p`,
});
/** One that drops the second step. */
const broken = (language: string) => ({
  title: `Parking ${language}`,
  body: `## Parking\n\n1. Drive and enter {{gate_code}}.\n\nMap: https://maps.example.com/p`,
});

function output(
  overrides: Partial<Record<GuestLanguage, { title: string; body: string }>> = {},
  tag = '',
): ModelResult {
  const translations = Object.fromEntries(
    GUEST_LANGUAGES.map((l) => [l, overrides[l] ?? good(l, tag)]),
  ) as Record<GuestLanguage, { title: string; body: string }>;
  return { ok: true, output: { source_language: 'hr', translations } };
}

/** A model that answers from a script, one entry per call. */
function scripted(...results: (ModelResult | (() => Promise<ModelResult>))[]) {
  const model: TranslationModel & { calls: number } = {
    calls: 0,
    async translate() {
      const next = results[model.calls];
      model.calls += 1;
      if (!next) throw new Error('unexpected model call');
      return typeof next === 'function' ? next() : next;
    },
  };
  return model;
}

let seq = 0;
async function fixture() {
  seq += 1;
  const { db } = testDb;
  const [host] = await db
    .insert(accounts)
    .values({ email: `t${seq}@example.test`, passwordHash: 'x', role: 'host' })
    .returning();
  if (!host) throw new Error('no host');
  const [property] = await db
    .insert(properties)
    .values({ hostId: host.id, name: 'Villa' })
    .returning();
  if (!property) throw new Error('no property');
  const [unit] = await db.insert(units).values({ propertyId: property.id, name: 'A1' }).returning();
  if (!unit) throw new Error('no unit');
  const [block] = await db
    .insert(infoBlocks)
    .values({ propertyId: property.id, category: 'arrival_access', ...SOURCE })
    .returning();
  if (!block) throw new Error('no block');
  return { property, unit, block };
}

const blockOf = async (id: string) => {
  const [b] = await testDb.db.select().from(infoBlocks).where(eq(infoBlocks.id, id));
  if (!b) throw new Error('no block');
  return b;
};

const rowsOf = (id: string, revision: number) =>
  testDb.db
    .select()
    .from(blockTranslations)
    .where(and(eq(blockTranslations.blockId, id), eq(blockTranslations.revision, revision)));

async function eventsFor(propertyId: string) {
  const jobs = await boss.findJobs<{ propertyId?: string }>(EVENT_QUEUE);
  return jobs.filter((j) => j.data.propertyId === propertyId);
}

/** Bumps the block to a new pending revision, as a save does. */
async function bump(id: string) {
  const b = await blockOf(id);
  await testDb.db
    .update(infoBlocks)
    .set({ revision: b.revision + 1, translationStatus: 'pending', translationError: null })
    .where(eq(infoBlocks.id, id));
  return b.revision + 1;
}

describe('runTranslation', () => {
  it('publishes when all seven languages pass, keeping the host text for the source', async () => {
    const { block, property } = await fixture();
    const model = scripted(output());
    expect(await runTranslation({ ...deps(), model }, { blockId: block.id, revision: 1 })).toBe(
      'published',
    );
    const rows = await rowsOf(block.id, 1);
    expect(rows).toHaveLength(7);
    const hr = rows.find((r) => r.language === 'hr');
    expect(hr).toMatchObject({ ...SOURCE, origin: 'source' });
    expect(rows.find((r) => r.language === 'de')?.origin).toBe('machine');
    const after = await blockOf(block.id);
    expect(after).toMatchObject({
      publishedRevision: 1,
      translationStatus: 'published',
      sourceLanguage: 'hr',
    });
    expect(await eventsFor(property.id)).toHaveLength(1);
  });

  it('retries once and fails a language that mismatches twice', async () => {
    const { block } = await fixture();
    const model = scripted(output({ de: broken('de') }), output({ de: broken('de') }));
    expect(await runTranslation({ ...deps(), model }, { blockId: block.id, revision: 1 })).toBe(
      'failed',
    );
    expect(model.calls).toBe(2);
    expect(await rowsOf(block.id, 1)).toHaveLength(6);
    expect(await blockOf(block.id)).toMatchObject({
      translationStatus: 'failed',
      translationError: 'structure-mismatch',
      publishedRevision: null,
    });
  });

  it('takes only the missing languages from the retry', async () => {
    const { block } = await fixture();
    const model = scripted(output({ de: broken('de') }), output({}, ' second'));
    expect(await runTranslation({ ...deps(), model }, { blockId: block.id, revision: 1 })).toBe(
      'published',
    );
    const rows = await rowsOf(block.id, 1);
    expect(rows.find((r) => r.language === 'hu')?.title).toBe('Parking hu');
    expect(rows.find((r) => r.language === 'de')?.title).toBe('Parking de second');
  });

  it('discards a result for a superseded revision', async () => {
    const { block } = await fixture();
    const model = scripted(async () => {
      await bump(block.id);
      return output();
    });
    expect(await runTranslation({ ...deps(), model }, { blockId: block.id, revision: 1 })).toBe(
      'discarded',
    );
    expect(await rowsOf(block.id, 1)).toHaveLength(0);
    expect((await blockOf(block.id)).publishedRevision).toBeNull();
  });

  it('keeps a host correction stored before the job runs', async () => {
    const { block } = await fixture();
    await testDb.db.insert(blockTranslations).values({
      blockId: block.id,
      revision: 1,
      language: 'fr',
      title: 'Mon titre',
      body: 'Mon texte',
      origin: 'host',
    });
    const model = scripted(output());
    expect(await runTranslation({ ...deps(), model }, { blockId: block.id, revision: 1 })).toBe(
      'published',
    );
    const fr = (await rowsOf(block.id, 1)).find((r) => r.language === 'fr');
    expect(fr).toMatchObject({ title: 'Mon titre', origin: 'host' });
  });

  it('replaces a correction of the source language made before it was detected', async () => {
    const { block } = await fixture();
    await correctTranslation(deps(), block.id, { language: 'hr', revision: 1, ...good('hr') });
    const model = scripted(output());
    expect(await runTranslation({ ...deps(), model }, { blockId: block.id, revision: 1 })).toBe(
      'published',
    );
    const hr = (await rowsOf(block.id, 1)).find((r) => r.language === 'hr');
    expect(hr).toMatchObject({ ...SOURCE, origin: 'source' });
  });

  it('marks a model error and a missing key as failed', async () => {
    const a = await fixture();
    const errored = scripted({ ok: false, error: 'model-error', detail: '529' });
    expect(
      await runTranslation({ ...deps(), model: errored }, { blockId: a.block.id, revision: 1 }),
    ).toBe('failed');
    expect((await blockOf(a.block.id)).translationError).toBe('model-error');

    const b = await fixture();
    const missing = scripted({ ok: false, error: 'not-configured', detail: 'no key' });
    await runTranslation({ ...deps(), model: missing }, { blockId: b.block.id, revision: 1 });
    expect((await blockOf(b.block.id)).translationError).toBe('not-configured');
  });

  it('keeps guests on the published revision while a newer one fails', async () => {
    const { block } = await fixture();
    await runTranslation(
      { ...deps(), model: scripted(output()) },
      { blockId: block.id, revision: 1 },
    );
    const revision = await bump(block.id);
    const model = scripted(output({ de: broken('de') }), output({ de: broken('de') }));
    expect(await runTranslation({ ...deps(), model }, { blockId: block.id, revision })).toBe(
      'failed',
    );
    expect((await blockOf(block.id)).publishedRevision).toBe(1);
    expect(await rowsOf(block.id, 1)).toHaveLength(7);
  });

  it('publishes without a model call when every language already exists', async () => {
    const { block } = await fixture();
    await testDb.db.insert(blockTranslations).values(
      GUEST_LANGUAGES.map((language) => ({
        blockId: block.id,
        revision: 1,
        language,
        ...good(language),
        origin: 'host' as const,
      })),
    );
    const model = scripted();
    expect(await runTranslation({ ...deps(), model }, { blockId: block.id, revision: 1 })).toBe(
      'published',
    );
    expect(model.calls).toBe(0);
  });
});

describe('correctTranslation', () => {
  async function failedOnGerman() {
    const f = await fixture();
    const model = scripted(output({ de: broken('de') }), output({ de: broken('de') }));
    await runTranslation({ ...deps(), model }, { blockId: f.block.id, revision: 1 });
    return f;
  }

  it('publishes a failed revision once the missing language is filled', async () => {
    const { block } = await failedOnGerman();
    const result = await correctTranslation(deps(), block.id, {
      language: 'de',
      revision: 1,
      ...good('de'),
    });
    expect(result.structureWarnings).toEqual([]);
    expect(await blockOf(block.id)).toMatchObject({
      translationStatus: 'published',
      publishedRevision: 1,
    });
  });

  it('emits the event when the published text changes', async () => {
    const { block, property } = await fixture();
    await runTranslation(
      { ...deps(), model: scripted(output()) },
      { blockId: block.id, revision: 1 },
    );
    await bump(block.id);
    await correctTranslation(deps(), block.id, { language: 'it', revision: 1, ...good('it', '!') });
    expect(await eventsFor(property.id)).toHaveLength(2);
    const it1 = (await rowsOf(block.id, 1)).find((r) => r.language === 'it');
    expect(it1).toMatchObject({ title: 'Parking it!', origin: 'host' });
  });

  it('rejects a stale revision and the source language', async () => {
    const { block } = await failedOnGerman();
    await expect(
      correctTranslation(deps(), block.id, { language: 'de', revision: 2, ...good('de') }),
    ).rejects.toMatchObject({ code: 'stale-revision' });
    await expect(
      correctTranslation(deps(), block.id, { language: 'hr', revision: 1, ...good('hr') }),
    ).rejects.toBeInstanceOf(TranslationRuleError);
  });

  it('reports a missing block as not found', async () => {
    await expect(
      correctTranslation(deps(), crypto.randomUUID(), {
        language: 'de',
        revision: 1,
        ...good('de'),
      }),
    ).rejects.toMatchObject({ code: 'not-found' });
  });

  it('saves a correction that breaks the structure, with warnings', async () => {
    const { block } = await failedOnGerman();
    const result = await correctTranslation(deps(), block.id, {
      language: 'de',
      revision: 1,
      ...broken('de'),
    });
    expect(result.structureWarnings.length).toBeGreaterThan(0);
    expect((await rowsOf(block.id, 1)).find((r) => r.language === 'de')?.origin).toBe('host');
  });
});

describe('retryTranslation', () => {
  it('moves a failed revision back to pending with a new job', async () => {
    const { block } = await fixture();
    await runTranslation(
      { ...deps(), model: scripted({ ok: false, error: 'model-error', detail: 'x' }) },
      { blockId: block.id, revision: 1 },
    );
    await retryTranslation(deps(), block.id);
    expect((await blockOf(block.id)).translationStatus).toBe('pending');
    const jobs = await boss.findJobs<{ blockId: string }>(QUEUES.translateBlock);
    expect(jobs.filter((j) => j.data.blockId === block.id)).toHaveLength(1);
    await expect(retryTranslation(deps(), block.id)).rejects.toMatchObject({
      code: 'translation-not-failed',
    });
  });
});

describe('listTranslations', () => {
  it('lists seven languages with the published text of an older revision', async () => {
    const { block } = await fixture();
    await runTranslation(
      { ...deps(), model: scripted(output()) },
      { blockId: block.id, revision: 1 },
    );
    await bump(block.id);
    const view = await listTranslations(testDb.db, await blockOf(block.id));
    expect(view.languages.map((l) => l.language)).toEqual([...GUEST_LANGUAGES]);
    expect(view.languages.every((l) => l.current === null && l.published !== null)).toBe(true);
    expect(view).toMatchObject({ revision: 2, publishedRevision: 1, status: 'pending' });
  });
});

describe('translationsDone', () => {
  it('is true only when every effective block is published', async () => {
    const { block, unit, property } = await fixture();
    expect(await translationsDone(testDb.db, unit.id)).toBe(false);
    await runTranslation(
      { ...deps(), model: scripted(output()) },
      { blockId: block.id, revision: 1 },
    );
    expect(await translationsDone(testDb.db, unit.id)).toBe(true);

    const [hidden] = await testDb.db
      .insert(infoBlocks)
      .values({ propertyId: property.id, category: 'how_tos', ...SOURCE })
      .returning();
    if (!hidden) throw new Error('no block');
    expect(await translationsDone(testDb.db, unit.id)).toBe(false);
    await testDb.db.insert(unitHiddenBlocks).values({ unitId: unit.id, blockId: hidden.id });
    expect(await translationsDone(testDb.db, unit.id)).toBe(true);
  });
});

describe('runTranslation with media captions', () => {
  /** A model that records each source it is asked to translate. */
  function recording(...results: ModelResult[]) {
    const sources: { title: string; body: string }[] = [];
    const model: TranslationModel = {
      async translate(source) {
        sources.push(source);
        const next = results[sources.length - 1];
        if (!next) throw new Error('unexpected model call');
        return next;
      },
    };
    return { model, sources };
  }

  const captions = (overrides: Partial<Record<GuestLanguage, string>> = {}): ModelResult => {
    const translations = Object.fromEntries(
      GUEST_LANGUAGES.map((l) => [
        l,
        { title: `Parking ${l}`, body: overrides[l] ?? `- ${l}:c1\n- ${l}:c2` },
      ]),
    ) as Record<GuestLanguage, { title: string; body: string }>;
    return { ok: true, output: { source_language: 'hr', translations } };
  };

  async function withMedia() {
    const f = await fixture();
    const rows = await testDb.db
      .insert(blockMedia)
      .values(
        ['c1', 'c2'].map((caption, position) => ({
          blockId: f.block.id,
          kind: 'image' as const,
          contentType: 'image/png',
          bytes: 10,
          caption,
          addedRevision: 1,
          position,
        })),
      )
      .returning();
    const [first, second] = rows;
    if (!first || !second) throw new Error('no media');
    return { ...f, media: [first.id, second.id] as const };
  }

  it('translates captions in a second call and stores them by media id', async () => {
    const { block, media } = await withMedia();
    const { model, sources } = recording(output(), captions());
    expect(await runTranslation({ ...deps(), model }, { blockId: block.id, revision: 1 })).toBe(
      'published',
    );
    expect(sources).toHaveLength(2);
    expect(sources[1]?.body).toBe('- c1\n- c2');
    const rows = await rowsOf(block.id, 1);
    const [m1, m2] = media;
    expect(rows.find((r) => r.language === 'de')?.captions).toEqual({
      [m1]: 'de:c1',
      [m2]: 'de:c2',
    });
    expect(rows.find((r) => r.language === 'hr')?.captions).toEqual({
      [m1]: 'c1',
      [m2]: 'c2',
    });
  });

  it('fails the revision when a language loses a caption', async () => {
    const { block } = await withMedia();
    const { model } = recording(output(), captions({ de: '- de:c1' }), captions({ de: '- de:c1' }));
    expect(await runTranslation({ ...deps(), model }, { blockId: block.id, revision: 1 })).toBe(
      'failed',
    );
    const rows = await rowsOf(block.id, 1);
    expect(rows.map((r) => r.language)).not.toContain('de');
    expect(await blockOf(block.id)).toMatchObject({
      translationStatus: 'failed',
      translationError: 'structure-mismatch',
      publishedRevision: null,
    });
  });

  it('makes one call and stores no captions for a block without media', async () => {
    const { block } = await fixture();
    const { model, sources } = recording(output());
    await runTranslation({ ...deps(), model }, { blockId: block.id, revision: 1 });
    expect(sources).toHaveLength(1);
    const rows = await rowsOf(block.id, 1);
    expect(rows.every((r) => Object.keys(r.captions).length === 0)).toBe(true);
  });

  it('keeps the machine captions when the host corrects a language', async () => {
    const { block, media } = await withMedia();
    const { model } = recording(output(), captions());
    await runTranslation({ ...deps(), model }, { blockId: block.id, revision: 1 });
    await correctTranslation(deps(), block.id, { language: 'de', revision: 1, ...good('de', '!') });
    const de = (await rowsOf(block.id, 1)).find((r) => r.language === 'de');
    expect(de).toMatchObject({ origin: 'host', title: 'Parking de!' });
    expect(de?.captions[media[0]]).toBe('de:c1');
  });

  it('drops an item deleted while the job ran', async () => {
    const { block, media } = await withMedia();
    const [m1, m2] = media;
    let calls = 0;
    const model: TranslationModel = {
      async translate() {
        calls += 1;
        if (calls === 1) return output();
        await testDb.db.delete(blockMedia).where(eq(blockMedia.id, m2));
        return captions();
      },
    };
    expect(await runTranslation({ ...deps(), model }, { blockId: block.id, revision: 1 })).toBe(
      'published',
    );
    const de = (await rowsOf(block.id, 1)).find((r) => r.language === 'de');
    expect(de?.captions).toEqual({ [m1]: 'de:c1' });
  });
});
