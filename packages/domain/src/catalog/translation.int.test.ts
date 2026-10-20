import { and, eq, sql } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { catalogRecords, catalogTranslations, destinations } from '../db/schema/catalog';
import { createJobQueue, ensureQueues, type JobQueue, QUEUES } from '../jobs/queue';
import { GUEST_LANGUAGES, type GuestLanguage } from '../property/vocabulary';
import { createTestDatabase, type TestDatabase } from '../testing';
import { type TranslationDeps, TranslationRuleError } from '../translation/job';
import type { ModelResult, TranslationModel } from '../translation/model';
import { createCatalogRecord, updateCatalogRecord } from './store';
import {
  listCatalogTranslations,
  retryCatalogTranslation,
  runCatalogTranslation,
} from './translation';

let testDb: TestDatabase;
let boss: PgBoss;
let queue: JobQueue;
let destinationId: string;

beforeAll(async () => {
  testDb = await createTestDatabase();
  boss = new PgBoss({ connectionString: testDb.url, supervise: false, schedule: false });
  boss.on('error', console.error);
  await boss.start();
  await ensureQueues(boss);
  queue = createJobQueue(boss);
  const [d] = await testDb.db
    .insert(destinations)
    .values({ name: 'Trogir', centre: { x: 16.2513, y: 43.5169 }, radiusM: 15_000 })
    .returning();
  if (!d) throw new Error('no destination');
  destinationId = d.id;
});

afterAll(async () => {
  await boss?.stop({ graceful: false, timeout: 1000 });
  await testDb?.drop();
});

const deps = (): TranslationDeps => ({ db: testDb.db, queue, now: () => new Date() });

const SOURCE = {
  title: 'Tvrđava Kamerlengo',
  description:
    '## Tvrđava\n\n- Pogled na kanal.\n- Koncerti ljeti.\n\nViše: https://visittrogir.hr/',
};

const good = (language: string, tag = '') => ({
  title: `Kamerlengo ${language}${tag}`,
  body: `## Fortress ${language}${tag}\n\n- View.\n- Concerts.\n\nMore: https://visittrogir.hr/`,
});
const broken = (language: string) => ({
  title: `Kamerlengo ${language}`,
  body: `## Fortress\n\n- View and concerts.\n\nMore: https://visittrogir.hr/`,
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

const create = () =>
  createCatalogRecord(
    testDb.db,
    queue,
    {
      destinationId,
      kind: 'place',
      placeCategory: 'sight',
      location: { x: 16.2475, y: 43.5161 },
      ...SOURCE,
    },
    new Date(),
  );

const recordOf = async (id: string) => {
  const [r] = await testDb.db.select().from(catalogRecords).where(eq(catalogRecords.id, id));
  if (!r) throw new Error('no record');
  return r;
};

const rowsOf = (id: string, revision: number) =>
  testDb.db
    .select()
    .from(catalogTranslations)
    .where(and(eq(catalogTranslations.recordId, id), eq(catalogTranslations.revision, revision)));

describe('runCatalogTranslation', () => {
  it('publishes seven languages, keeping the source text in the source slot', async () => {
    const record = await create();
    const model = scripted(output());
    expect(
      await runCatalogTranslation({ ...deps(), model }, { recordId: record.id, revision: 1 }),
    ).toBe('published');
    const rows = await rowsOf(record.id, 1);
    expect(rows).toHaveLength(7);
    expect(rows.find((r) => r.language === 'hr')).toMatchObject({
      title: SOURCE.title,
      body: SOURCE.description,
      origin: 'source',
    });
    expect(await recordOf(record.id)).toMatchObject({
      publishedRevision: 1,
      translationStatus: 'published',
      sourceLanguage: 'hr',
    });
  });

  it('discards a job for a revision that moved on, or a deleted record', async () => {
    const record = await create();
    await updateCatalogRecord(testDb.db, queue, record.id, { title: 'Kamerlengo' }, new Date());
    const model = scripted();
    expect(
      await runCatalogTranslation({ ...deps(), model }, { recordId: record.id, revision: 1 }),
    ).toBe('discarded');
    expect(
      await runCatalogTranslation(
        { ...deps(), model },
        { recordId: '00000000-0000-4000-8000-000000000000', revision: 1 },
      ),
    ).toBe('discarded');
    expect(model.calls).toBe(0);
  });

  it('marks a model error failed and stores nothing', async () => {
    const record = await create();
    const model = scripted({ ok: false, error: 'model-error', detail: 'boom' });
    expect(
      await runCatalogTranslation({ ...deps(), model }, { recordId: record.id, revision: 1 }),
    ).toBe('failed');
    expect(await recordOf(record.id)).toMatchObject({
      translationStatus: 'failed',
      translationError: 'model-error',
    });
    expect(await rowsOf(record.id, 1)).toHaveLength(0);
  });

  it('fails with structure-mismatch when one language breaks twice, keeping the six', async () => {
    const record = await create();
    const model = scripted(output({ de: broken('de') }), output({ de: broken('de') }));
    expect(
      await runCatalogTranslation({ ...deps(), model }, { recordId: record.id, revision: 1 }),
    ).toBe('failed');
    expect(model.calls).toBe(2);
    expect(await rowsOf(record.id, 1)).toHaveLength(6);
    expect(await recordOf(record.id)).toMatchObject({
      translationStatus: 'failed',
      translationError: 'structure-mismatch',
      publishedRevision: null,
    });
  });

  it('deletes older-revision rows on publication', async () => {
    const record = await create();
    await runCatalogTranslation(
      { ...deps(), model: scripted(output()) },
      { recordId: record.id, revision: 1 },
    );
    await updateCatalogRecord(testDb.db, queue, record.id, { title: 'Kamerlengo' }, new Date());
    // Before publication of revision 2, guests still see revision 1.
    expect(await rowsOf(record.id, 1)).toHaveLength(7);
    await runCatalogTranslation(
      { ...deps(), model: scripted(output({}, ' v2')) },
      { recordId: record.id, revision: 2 },
    );
    expect(await rowsOf(record.id, 1)).toHaveLength(0);
    expect(await rowsOf(record.id, 2)).toHaveLength(7);
    expect((await recordOf(record.id)).publishedRevision).toBe(2);
  });
});

describe('retryCatalogTranslation', () => {
  const jobsFor = async (recordId: string) => {
    const { rows } = await testDb.db.execute<{ n: number }>(
      sql`select count(*)::int as n from pgboss.job where name = ${QUEUES.translateCatalogRecord} and data->>'recordId' = ${recordId}`,
    );
    return rows[0]?.n ?? 0;
  };

  it('moves a failed record back to pending and queues a fresh job', async () => {
    const record = await create();
    await runCatalogTranslation(
      { ...deps(), model: scripted({ ok: false, error: 'model-error', detail: 'x' }) },
      { recordId: record.id, revision: 1 },
    );
    expect(await jobsFor(record.id)).toBe(1);
    await retryCatalogTranslation(deps(), record.id);
    expect((await recordOf(record.id)).translationStatus).toBe('pending');
    expect(await jobsFor(record.id)).toBe(2);
  });

  it('refuses a record that has not failed', async () => {
    const record = await create();
    await expect(retryCatalogTranslation(deps(), record.id)).rejects.toEqual(
      new TranslationRuleError('translation-not-failed'),
    );
  });
});

describe('listCatalogTranslations', () => {
  it('lists seven languages, empty while pending', async () => {
    const record = await create();
    const view = await listCatalogTranslations(testDb.db, record);
    expect(view.languages.map((l) => l.language)).toEqual([...GUEST_LANGUAGES]);
    expect(view.languages.every((l) => l.current === null)).toBe(true);
    expect(view).toMatchObject({ recordId: record.id, revision: 1, status: 'pending' });
  });
});
