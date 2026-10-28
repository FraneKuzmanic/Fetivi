import { and, eq } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accounts } from '../db/schema/accounts';
import { infoBlocks } from '../db/schema/info-blocks';
import { properties } from '../db/schema/properties';
import { blockTranslations } from '../db/schema/translations';
import { createJobQueue, EVENTS, ensureQueues, type JobQueue } from '../jobs/queue';
import { GUEST_LANGUAGES, type GuestLanguage } from '../property/vocabulary';
import { createTestDatabase, type TestDatabase } from '../testing';
import type { TranslationDeps } from './job';
import type { ModelResult, TranslationModel } from './model';
import { retitleBlocks } from './retitle';

let testDb: TestDatabase;
let boss: PgBoss;
let queue: JobQueue;
const EVENT_QUEUE = 'test-retitle-projection';

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

// Each test starts from an empty block table: retitleBlocks scans the whole database.
beforeEach(async () => {
  await testDb.db.delete(infoBlocks);
});

const deps = (): TranslationDeps => ({ db: testDb.db, queue, now: () => new Date() });

const BODY = 'Vozite do kraja ulice i parkirajte ispred kuće.';

/** The model's answer: the title detected as `titleLanguage`, the hr slot titled `hrTitle`. */
function answer(titleLanguage: GuestLanguage, hrTitle: string): ModelResult {
  const translations = Object.fromEntries(
    GUEST_LANGUAGES.map((l) => [l, { title: l === 'hr' ? hrTitle : `Title ${l}`, body: BODY }]),
  ) as Record<GuestLanguage, { title: string; body: string }>;
  return {
    ok: true,
    output: { source_language: 'hr', title_language: titleLanguage, translations },
  };
}

function scripted(...results: ModelResult[]) {
  const model: TranslationModel & { calls: number } = {
    calls: 0,
    async translate() {
      const next = results[model.calls];
      model.calls += 1;
      if (!next) throw new Error('unexpected model call');
      return next;
    },
  };
  return model;
}

let seq = 0;
/** A published block whose source slot holds its own title, as the job stored it before 56. */
async function published({
  title = 'How to find us',
  wizardKey = 'arrival_directions' as string | null,
  revision = 1,
} = {}) {
  seq += 1;
  const { db } = testDb;
  const [host] = await db
    .insert(accounts)
    .values({ email: `r${seq}@example.test`, passwordHash: 'x', role: 'host' })
    .returning();
  if (!host) throw new Error('no host');
  const [property] = await db
    .insert(properties)
    .values({ hostId: host.id, name: 'Villa' })
    .returning();
  if (!property) throw new Error('no property');
  const [block] = await db
    .insert(infoBlocks)
    .values({
      propertyId: property.id,
      category: 'arrival_access',
      title,
      body: BODY,
      wizardKey,
      revision,
      publishedRevision: 1,
      translationStatus: revision === 1 ? 'published' : 'pending',
      sourceLanguage: 'hr',
    })
    .returning();
  if (!block) throw new Error('no block');
  await db.insert(blockTranslations).values(
    GUEST_LANGUAGES.map((language) => ({
      blockId: block.id,
      revision: 1,
      language,
      title: language === 'hr' ? title : `Title ${language}`,
      body: BODY,
      origin: language === 'hr' ? ('source' as const) : ('machine' as const),
    })),
  );
  return { property, block };
}

const rowsOf = (id: string) =>
  testDb.db
    .select()
    .from(blockTranslations)
    .where(and(eq(blockTranslations.blockId, id), eq(blockTranslations.revision, 1)));

const blockOf = async (id: string) => {
  const [b] = await testDb.db.select().from(infoBlocks).where(eq(infoBlocks.id, id));
  if (!b) throw new Error('no block');
  return b;
};

async function eventsFor(propertyId: string) {
  const jobs = await boss.findJobs<{ propertyId?: string }>(EVENT_QUEUE);
  return jobs.filter((j) => j.data.propertyId === propertyId);
}

describe('retitleBlocks', () => {
  it('translates the source-slot title of a published wizard block in place', async () => {
    const { block, property } = await published();
    const before = await rowsOf(block.id);
    const model = scripted(answer('en', 'Kako do nas'));
    expect(await retitleBlocks({ ...deps(), model })).toEqual({
      checked: 1,
      retitled: 1,
      failed: 0,
    });
    const rows = await rowsOf(block.id);
    expect(rows.find((r) => r.language === 'hr')).toMatchObject({
      title: 'Kako do nas',
      body: BODY,
      origin: 'source',
    });
    for (const row of rows.filter((r) => r.language !== 'hr')) {
      expect(row).toMatchObject(before.find((r) => r.language === row.language) ?? {});
    }
    expect(await blockOf(block.id)).toMatchObject({
      title: 'How to find us',
      revision: 1,
      publishedRevision: 1,
      translationStatus: 'published',
    });
    expect(await eventsFor(property.id)).toHaveLength(1);
  });

  it('skips a block written outside the wizard', async () => {
    await published({ title: 'Kako doći do nas', wizardKey: null });
    const model = scripted();
    expect(await retitleBlocks({ ...deps(), model })).toEqual({
      checked: 0,
      retitled: 0,
      failed: 0,
    });
    expect(model.calls).toBe(0);
  });

  it('skips a block with a newer revision being translated', async () => {
    await published({ revision: 2 });
    const model = scripted();
    expect((await retitleBlocks({ ...deps(), model })).checked).toBe(0);
    expect(model.calls).toBe(0);
  });

  it('keeps a title the model finds already in the source language', async () => {
    const { block } = await published({ title: 'Parkiranje' });
    const model = scripted(answer('hr', 'Parkiralište'));
    expect(await retitleBlocks({ ...deps(), model })).toEqual({
      checked: 1,
      retitled: 0,
      failed: 0,
    });
    expect((await rowsOf(block.id)).find((r) => r.language === 'hr')?.title).toBe('Parkiranje');
  });

  it('makes no model call on a second run', async () => {
    await published();
    await retitleBlocks({ ...deps(), model: scripted(answer('en', 'Kako do nas')) });
    const again = scripted();
    expect((await retitleBlocks({ ...deps(), model: again })).checked).toBe(0);
    expect(again.calls).toBe(0);
  });

  it('counts a model error and leaves the data', async () => {
    const { block } = await published();
    const model = scripted({ ok: false, error: 'model-error', detail: '529' });
    expect(await retitleBlocks({ ...deps(), model })).toEqual({
      checked: 1,
      retitled: 0,
      failed: 1,
    });
    expect((await rowsOf(block.id)).find((r) => r.language === 'hr')?.title).toBe('How to find us');
  });
});
