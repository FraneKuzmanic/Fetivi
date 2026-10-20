import { eq, sql } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pgCode } from '../db/client';
import { accounts } from '../db/schema/accounts';
import { catalogRecords, destinations } from '../db/schema/catalog';
import { allotmentSlots, offers, providers } from '../db/schema/offers';
import { createJobQueue, ensureQueues, type JobQueue, QUEUES } from '../jobs/queue';
import { createTestDatabase, type TestDatabase } from '../testing';
import { createOffer, type NewOffer, OfferRuleError, updateOffer } from './store';
import { OFFER_CATEGORIES, ORDER_KINDS } from './vocabulary';

let testDb: TestDatabase;
let boss: PgBoss;
let queue: JobQueue;
let trogir: string;
let split: string;
let providerId: string;
const NOW = new Date('2027-05-01T10:00:00Z');

beforeAll(async () => {
  testDb = await createTestDatabase();
  boss = new PgBoss({ connectionString: testDb.url, supervise: false, schedule: false });
  boss.on('error', console.error);
  await boss.start();
  await ensureQueues(boss);
  queue = createJobQueue(boss);
  trogir = await newDestination('Trogir');
  split = await newDestination('Split');
  const [p] = await testDb.db
    .insert(providers)
    .values({ name: 'Mare', email: 'mare@example.test' })
    .returning();
  if (!p) throw new Error('no provider');
  providerId = p.id;
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

async function newRecord(destinationId: string, kind: 'place' | 'event') {
  const [r] = await testDb.db
    .insert(catalogRecords)
    .values(
      kind === 'place'
        ? {
            destinationId,
            kind,
            title: 'Kamerlengo',
            description: 'A fortress.',
            placeCategory: 'sight',
            location: { x: 16.2475, y: 43.5161 },
          }
        : {
            destinationId,
            kind,
            title: 'Concert',
            description: 'Music.',
            startsAt: new Date('2027-07-01T18:00:00Z'),
            endsAt: new Date('2027-07-01T20:00:00Z'),
          },
    )
    .returning();
  if (!r) throw new Error('no record');
  return r.id;
}

const offer = (extra: Partial<NewOffer> = {}): NewOffer => ({
  providerId,
  destinationId: trogir,
  title: 'Boat trip',
  description: 'A day on the water.',
  cancellationPolicy: 'Free until 24 hours before.',
  category: 'boat_trip',
  orderKind: 'booking',
  availabilityMode: 'allotment',
  paymentMode: 'direct',
  priceMinor: 4_500,
  ...extra,
});
const create = (values: NewOffer) => createOffer(testDb.db, queue, values, NOW);
const update = (id: string, changes: Parameters<typeof updateOffer>[3]) =>
  updateOffer(testDb.db, queue, id, changes, NOW);
const invalid = new OfferRuleError('invalid-input');

const jobCount = async () => {
  const { rows } = await testDb.db.execute<{ n: number }>(
    sql`select count(*)::int as n from pgboss.job where name = ${QUEUES.translateOffer}`,
  );
  return rows[0]?.n ?? 0;
};

describe('owner and destination', () => {
  it('needs exactly one owner', async () => {
    const [host] = await testDb.db
      .insert(accounts)
      .values({ email: 'host@example.test', passwordHash: 'x', role: 'host' })
      .returning();
    if (!host) throw new Error('no host');
    await expect(create(offer({ providerId: null }))).rejects.toEqual(invalid);
    await expect(create(offer({ hostId: host.id }))).rejects.toEqual(invalid);
    const hostOffer = await create(
      offer({ providerId: null, hostId: host.id, destinationId: null }),
    );
    expect(hostOffer.destinationId).toBeNull();
  });

  it('needs a destination for a Provider Offer', async () => {
    await expect(create(offer({ destinationId: null }))).rejects.toEqual(invalid);
  });
});

describe('row checks', () => {
  it('allows a null price only for requests', async () => {
    await expect(create(offer({ priceMinor: null }))).rejects.toEqual(invalid);
    const request = await create(
      offer({ orderKind: 'request', availabilityMode: 'on_request', priceMinor: null }),
    );
    expect(request.priceMinor).toBeNull();
  });

  it('requires on-request mode for requests', async () => {
    await expect(create(offer({ orderKind: 'request' }))).rejects.toEqual(invalid);
  });

  it('ties live mode to an adapter and a reference', async () => {
    await expect(create(offer({ availabilityMode: 'live' }))).rejects.toEqual(invalid);
    await expect(create(offer({ availabilityMode: 'live', adapterKind: 'bokun' }))).rejects.toEqual(
      invalid,
    );
    await expect(create(offer({ adapterKind: 'bokun', externalProductRef: 'x' }))).rejects.toEqual(
      invalid,
    );
    const live = await create(
      offer({ availabilityMode: 'live', adapterKind: 'bokun', externalProductRef: 'P-1' }),
    );
    expect(live.adapterKind).toBe('bokun');
  });

  it('keeps the response window under four days with from before to', async () => {
    // 08:00–21:00 is 780 counted minutes a day: 4 × 780 would reach 4 days after a late request.
    await expect(create(offer({ responseWindowMinutes: 3_120 }))).rejects.toEqual(invalid);
    await expect(create(offer({ responseWindowMinutes: 0 }))).rejects.toEqual(invalid);
    expect((await create(offer({ responseWindowMinutes: 3_119 }))).responseWindowMinutes).toBe(
      3_119,
    );
    const allDay = { responseHoursFrom: '00:00', responseHoursTo: '23:59' };
    await expect(create(offer({ ...allDay, responseWindowMinutes: 5_756 }))).rejects.toEqual(
      invalid,
    );
    expect(
      (await create(offer({ ...allDay, responseWindowMinutes: 5_755 }))).responseWindowMinutes,
    ).toBe(5_755);
    await expect(
      create(offer({ responseHoursFrom: '21:00', responseHoursTo: '08:00' })),
    ).rejects.toEqual(invalid);
    await expect(
      create(offer({ responseHoursFrom: '10:00', responseHoursTo: '10:00' })),
    ).rejects.toEqual(invalid);
  });

  it('bounds the refund rules and the currency', async () => {
    await expect(create(offer({ refundPercentAfter: 101 }))).rejects.toEqual(invalid);
    await expect(create(offer({ freeCancelHoursBefore: 721 }))).rejects.toEqual(invalid);
    await expect(create(offer({ currency: 'eur' }))).rejects.toEqual(invalid);
  });

  it('applies the defaults', async () => {
    const row = await create(offer());
    expect(row).toMatchObject({
      currency: 'EUR',
      priceUnit: 'person',
      freeCancelHoursBefore: 24,
      refundPercentAfter: 0,
      responseWindowMinutes: 30,
      responseHoursFrom: '08:00:00',
      responseHoursTo: '21:00:00',
      contactFields: 'name',
      active: true,
      revision: 1,
      translationStatus: 'pending',
    });
  });

  it('keeps Order kind and Category independent', async () => {
    for (const category of OFFER_CATEGORIES) {
      for (const orderKind of ORDER_KINDS) {
        const mode = orderKind === 'request' ? 'on_request' : 'allotment';
        await expect(
          create(offer({ category, orderKind, availabilityMode: mode })),
        ).resolves.toMatchObject({ category, orderKind });
      }
    }
  });
});

describe('revision and translation enqueue', () => {
  it('enqueues on create and only on a text change', async () => {
    const before = await jobCount();
    const row = await create(offer());
    expect(await jobCount()).toBe(before + 1);

    const priced = await update(row.id, { priceMinor: 5_000, title: row.title });
    expect(priced.revision).toBe(1);
    expect(await jobCount()).toBe(before + 1);

    const policy = await update(row.id, { cancellationPolicy: 'No refunds.' });
    expect(policy).toMatchObject({ revision: 2, translationStatus: 'pending' });
    expect(await jobCount()).toBe(before + 2);
  });
});

describe('place link', () => {
  it('accepts a place in the same destination only', async () => {
    const here = await newRecord(trogir, 'place');
    const there = await newRecord(split, 'place');
    const event = await newRecord(trogir, 'event');
    const row = await create(offer({ placeId: here }));
    expect(row.placeId).toBe(here);
    await expect(create(offer({ placeId: there }))).rejects.toEqual(invalid);
    await expect(update(row.id, { placeId: event })).rejects.toEqual(invalid);
    await expect(update(row.id, { placeId: there })).rejects.toEqual(invalid);
    expect((await update(row.id, { placeId: null })).placeId).toBeNull();
  });

  it('refuses a place on an Offer without a destination', async () => {
    const [host] = await testDb.db
      .insert(accounts)
      .values({ email: 'host2@example.test', passwordHash: 'x', role: 'host' })
      .returning();
    if (!host) throw new Error('no host');
    const place = await newRecord(trogir, 'place');
    await expect(
      create(offer({ providerId: null, hostId: host.id, destinationId: null, placeId: place })),
    ).rejects.toEqual(invalid);
  });

  it('nulls the link when the place is deleted, without a new revision', async () => {
    const place = await newRecord(trogir, 'place');
    const row = await create(offer({ placeId: place }));
    await testDb.db.delete(catalogRecords).where(eq(catalogRecords.id, place));
    const [after] = await testDb.db.select().from(offers).where(eq(offers.id, row.id));
    expect(after).toMatchObject({ placeId: null, revision: 1 });
  });
});

describe('mode and slots', () => {
  it('refuses to leave allotment mode while slots exist', async () => {
    const row = await create(offer());
    await testDb.db.insert(allotmentSlots).values({
      offerId: row.id,
      startsAt: new Date('2027-06-01T07:00:00Z'),
      capacity: 5,
      remaining: 5,
    });
    await expect(update(row.id, { availabilityMode: 'on_request' })).rejects.toEqual(
      new OfferRuleError('offer-has-slots'),
    );
    expect((await update(row.id, { availabilityMode: 'allotment' })).availabilityMode).toBe(
      'allotment',
    );
  });

  it('reports a missing Offer', async () => {
    await expect(update('00000000-0000-4000-8000-000000000000', { title: 'x' })).rejects.toEqual(
      new OfferRuleError('not-found'),
    );
  });
});

describe('foreign keys', () => {
  const codeOf = (p: Promise<unknown>) =>
    p.then(
      () => 'ok',
      (e: unknown) => pgCode(e),
    );

  it('refuses to delete a Provider with Offers', async () => {
    expect(await codeOf(testDb.db.delete(providers).where(eq(providers.id, providerId)))).toBe(
      '23503',
    );
  });

  it('refuses to delete a destination with Offers', async () => {
    expect(await codeOf(testDb.db.delete(destinations).where(eq(destinations.id, trogir)))).toBe(
      '23503',
    );
  });
});
