import { and, eq, sql } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { destinations } from '../db/schema/catalog';
import { offers, offerTranslations, providers } from '../db/schema/offers';
import { createJobQueue, ensureQueues, type JobQueue, QUEUES } from '../jobs/queue';
import { GUEST_LANGUAGES, type GuestLanguage } from '../property/vocabulary';
import { createTestDatabase, type TestDatabase } from '../testing';
import { type TranslationDeps, TranslationRuleError } from '../translation/job';
import type { ModelResult, TranslationModel } from '../translation/model';
import { createOffer, updateOffer } from './store';
import { listOfferTranslations, retryOfferTranslation, runOfferTranslation } from './translation';

let testDb: TestDatabase;
let boss: PgBoss;
let queue: JobQueue;
let destinationId: string;
let providerId: string;

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
  const [p] = await testDb.db
    .insert(providers)
    .values({ name: 'Mare', email: 'mare@example.test' })
    .returning();
  if (!d || !p) throw new Error('no fixture');
  destinationId = d.id;
  providerId = p.id;
});

afterAll(async () => {
  await boss?.stop({ graceful: false, timeout: 1000 });
  await testDb?.drop();
});

const deps = (): TranslationDeps => ({ db: testDb.db, queue, now: () => new Date() });

const SOURCE = {
  title: 'Izlet brodom',
  description: '## Izlet\n\n- Plava laguna.\n- Ručak.\n\nViše: https://visittrogir.hr/',
  cancellationPolicy: 'Besplatno otkazivanje do 24 sata prije polaska.',
};

type Slot = { title: string; body: string };
const mainGood = (language: string, tag = ''): Slot => ({
  title: `Boat trip ${language}${tag}`,
  body: `## Trip ${language}${tag}\n\n- Blue Lagoon.\n- Lunch.\n\nMore: https://visittrogir.hr/`,
});
const policyGood = (language: string): Slot => ({
  title: `Ignored ${language}`,
  body: `Free cancellation ${language} up to 24 hours before departure.`,
});
const policyBroken = (language: string): Slot => ({
  title: `Ignored ${language}`,
  body: `## Policy ${language}\n\n- Free.\n- Then none.`,
});

function output(
  slot: (l: string) => Slot,
  overrides: Partial<Record<GuestLanguage, Slot>> = {},
): ModelResult {
  const translations = Object.fromEntries(
    GUEST_LANGUAGES.map((l) => [l, overrides[l] ?? slot(l)]),
  ) as Record<GuestLanguage, Slot>;
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
  createOffer(
    testDb.db,
    queue,
    {
      providerId,
      destinationId,
      ...SOURCE,
      category: 'boat_trip',
      orderKind: 'booking',
      availabilityMode: 'on_request',
      paymentMode: 'direct',
      priceMinor: 4_500,
    },
    new Date(),
  );

const offerOf = async (id: string) => {
  const [o] = await testDb.db.select().from(offers).where(eq(offers.id, id));
  if (!o) throw new Error('no offer');
  return o;
};

const rowsOf = (id: string, revision: number) =>
  testDb.db
    .select()
    .from(offerTranslations)
    .where(and(eq(offerTranslations.offerId, id), eq(offerTranslations.revision, revision)));

describe('runOfferTranslation', () => {
  it('publishes seven languages with the policy text from the second call', async () => {
    const offer = await create();
    const model = scripted(output(mainGood), output(policyGood));
    expect(
      await runOfferTranslation({ ...deps(), model }, { offerId: offer.id, revision: 1 }),
    ).toBe('published');
    expect(model.calls).toBe(2);
    const rows = await rowsOf(offer.id, 1);
    expect(rows).toHaveLength(7);
    expect(rows.find((r) => r.language === 'de')).toMatchObject({
      title: 'Boat trip de',
      cancellationPolicy: policyGood('de').body,
      origin: 'machine',
    });
    expect(rows.find((r) => r.language === 'hr')).toMatchObject({
      title: SOURCE.title,
      body: SOURCE.description,
      cancellationPolicy: SOURCE.cancellationPolicy,
      origin: 'source',
    });
    expect(await offerOf(offer.id)).toMatchObject({
      publishedRevision: 1,
      translationStatus: 'published',
      sourceLanguage: 'hr',
    });
  });

  it('leaves a language out when its policy text breaks twice', async () => {
    const offer = await create();
    const model = scripted(
      output(mainGood),
      output(policyGood, { de: policyBroken('de') }),
      output(policyGood, { de: policyBroken('de') }),
    );
    expect(
      await runOfferTranslation({ ...deps(), model }, { offerId: offer.id, revision: 1 }),
    ).toBe('failed');
    expect(model.calls).toBe(3);
    const rows = await rowsOf(offer.id, 1);
    expect(rows).toHaveLength(6);
    expect(rows.some((r) => r.language === 'de')).toBe(false);
    expect(await offerOf(offer.id)).toMatchObject({
      translationStatus: 'failed',
      translationError: 'structure-mismatch',
      publishedRevision: null,
    });
  });

  it('discards a superseded revision without calling the model', async () => {
    const offer = await create();
    await updateOffer(
      testDb.db,
      queue,
      offer.id,
      { cancellationPolicy: 'Nema povrata.' },
      new Date(),
    );
    const model = scripted();
    expect(
      await runOfferTranslation({ ...deps(), model }, { offerId: offer.id, revision: 1 }),
    ).toBe('discarded');
    expect(model.calls).toBe(0);
  });

  it('marks a first-call model error failed after one call', async () => {
    const offer = await create();
    const model = scripted({ ok: false, error: 'model-error', detail: 'boom' });
    expect(
      await runOfferTranslation({ ...deps(), model }, { offerId: offer.id, revision: 1 }),
    ).toBe('failed');
    expect(model.calls).toBe(1);
    expect(await offerOf(offer.id)).toMatchObject({
      translationStatus: 'failed',
      translationError: 'model-error',
    });
    expect(await rowsOf(offer.id, 1)).toHaveLength(0);
  });
});

describe('retryOfferTranslation', () => {
  const jobsFor = async (offerId: string) => {
    const { rows } = await testDb.db.execute<{ n: number }>(
      sql`select count(*)::int as n from pgboss.job where name = ${QUEUES.translateOffer} and data->>'offerId' = ${offerId}`,
    );
    return rows[0]?.n ?? 0;
  };

  it('moves a failed Offer back to pending and queues a fresh job', async () => {
    const offer = await create();
    await runOfferTranslation(
      { ...deps(), model: scripted({ ok: false, error: 'model-error', detail: 'x' }) },
      { offerId: offer.id, revision: 1 },
    );
    expect(await jobsFor(offer.id)).toBe(1);
    await retryOfferTranslation(deps(), offer.id);
    expect((await offerOf(offer.id)).translationStatus).toBe('pending');
    expect(await jobsFor(offer.id)).toBe(2);
  });

  it('refuses an Offer that has not failed', async () => {
    const offer = await create();
    await expect(retryOfferTranslation(deps(), offer.id)).rejects.toEqual(
      new TranslationRuleError('translation-not-failed'),
    );
  });
});

describe('listOfferTranslations', () => {
  it('lists seven languages with three fields each', async () => {
    const offer = await create();
    expect(
      (await listOfferTranslations(testDb.db, offer)).languages.every((l) => l.current === null),
    ).toBe(true);
    await runOfferTranslation(
      { ...deps(), model: scripted(output(mainGood), output(policyGood)) },
      { offerId: offer.id, revision: 1 },
    );
    const view = await listOfferTranslations(testDb.db, await offerOf(offer.id));
    expect(view.languages.map((l) => l.language)).toEqual([...GUEST_LANGUAGES]);
    expect(view).toMatchObject({ offerId: offer.id, revision: 1, status: 'published' });
    expect(view.languages[0]?.current).toMatchObject({
      title: 'Boat trip en',
      body: mainGood('en').body,
      cancellationPolicy: policyGood('en').body,
    });
  });
});
