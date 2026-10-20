import { eq } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { destinations } from '../db/schema/catalog';
import { allotmentSlots, offers, providers } from '../db/schema/offers';
import { createJobQueue, ensureQueues, type JobQueue } from '../jobs/queue';
import { createTestDatabase, type TestDatabase } from '../testing';
import { addAllotmentSlots, deleteSlot, setSlotCapacity } from './slots';
import { createOffer, deleteOffer, type NewOffer, OfferRuleError } from './store';

let testDb: TestDatabase;
let boss: PgBoss;
let queue: JobQueue;
let destinationId: string;
let providerId: string;
const NOW = new Date('2027-05-01T10:00:00Z');
const at = (iso: string) => new Date(iso);

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

const newOffer = (extra: Partial<NewOffer> = {}) =>
  createOffer(
    testDb.db,
    queue,
    {
      providerId,
      destinationId,
      title: 'Boat trip',
      description: 'A day on the water.',
      cancellationPolicy: 'Free until 24 hours before.',
      category: 'boat_trip',
      orderKind: 'booking',
      availabilityMode: 'allotment',
      paymentMode: 'direct',
      priceMinor: 4_500,
      ...extra,
    },
    NOW,
  );

const slotsOf = (offerId: string) =>
  testDb.db
    .select()
    .from(allotmentSlots)
    .where(eq(allotmentSlots.offerId, offerId))
    .orderBy(allotmentSlots.startsAt);

/** Simulates seats taken by Orders (ticket 15) by lowering `remaining` directly. */
const take = (slotId: string, remaining: number) =>
  testDb.db.update(allotmentSlots).set({ remaining }).where(eq(allotmentSlots.id, slotId));

describe('addAllotmentSlots', () => {
  it('creates future slots and skips past and existing instants', async () => {
    const offer = await newOffer();
    const first = await addAllotmentSlots(
      testDb.db,
      offer.id,
      [at('2027-04-30T07:00:00Z'), at('2027-05-02T07:00:00Z'), at('2027-05-03T07:00:00Z')],
      10,
      NOW,
    );
    expect(first).toEqual({ created: 2, skipped: 1 });
    const again = await addAllotmentSlots(
      testDb.db,
      offer.id,
      [at('2027-05-03T07:00:00Z'), at('2027-05-04T07:00:00Z')],
      10,
      NOW,
    );
    expect(again).toEqual({ created: 1, skipped: 1 });
    const rows = await slotsOf(offer.id);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.capacity === 10 && r.remaining === 10)).toBe(true);
  });

  it('refuses an Offer that is not in allotment mode, or a missing one', async () => {
    const offer = await newOffer({ availabilityMode: 'on_request' });
    await expect(
      addAllotmentSlots(testDb.db, offer.id, [at('2027-06-01T07:00:00Z')], 5, NOW),
    ).rejects.toEqual(new OfferRuleError('invalid-input'));
    await expect(
      addAllotmentSlots(
        testDb.db,
        '00000000-0000-4000-8000-000000000000',
        [at('2027-06-01T07:00:00Z')],
        5,
        NOW,
      ),
    ).rejects.toEqual(new OfferRuleError('not-found'));
  });

  it('refuses a capacity out of range', async () => {
    const offer = await newOffer();
    await expect(
      addAllotmentSlots(testDb.db, offer.id, [at('2027-06-01T07:00:00Z')], 1000, NOW),
    ).rejects.toEqual(new OfferRuleError('invalid-input'));
  });
});

describe('setSlotCapacity', () => {
  it('keeps the taken seats', async () => {
    const offer = await newOffer();
    await addAllotmentSlots(testDb.db, offer.id, [at('2027-06-01T07:00:00Z')], 10, NOW);
    const [slot] = await slotsOf(offer.id);
    if (!slot) throw new Error('no slot');
    await take(slot.id, 7);
    expect(await setSlotCapacity(testDb.db, slot.id, 12)).toMatchObject({
      capacity: 12,
      remaining: 9,
    });
    expect(await setSlotCapacity(testDb.db, slot.id, 3)).toMatchObject({
      capacity: 3,
      remaining: 0,
    });
    await expect(setSlotCapacity(testDb.db, slot.id, 2)).rejects.toEqual(
      new OfferRuleError('seats-taken'),
    );
    await expect(
      setSlotCapacity(testDb.db, '00000000-0000-4000-8000-000000000000', 5),
    ).rejects.toEqual(new OfferRuleError('not-found'));
  });
});

describe('deleteSlot and deleteOffer', () => {
  it('refuses while seats are taken and cascades otherwise', async () => {
    const offer = await newOffer();
    await addAllotmentSlots(
      testDb.db,
      offer.id,
      [at('2027-06-01T07:00:00Z'), at('2027-06-02T07:00:00Z')],
      10,
      NOW,
    );
    const [a, b] = await slotsOf(offer.id);
    if (!a || !b) throw new Error('no slots');
    await take(a.id, 9);
    await expect(deleteSlot(testDb.db, a.id)).rejects.toEqual(new OfferRuleError('seats-taken'));
    await expect(deleteOffer(testDb.db, offer.id)).rejects.toEqual(
      new OfferRuleError('seats-taken'),
    );
    await deleteSlot(testDb.db, b.id);
    await expect(deleteSlot(testDb.db, b.id)).rejects.toEqual(new OfferRuleError('not-found'));

    await take(a.id, 10);
    await deleteOffer(testDb.db, offer.id);
    expect(await slotsOf(offer.id)).toHaveLength(0);
    expect(await testDb.db.select().from(offers).where(eq(offers.id, offer.id))).toHaveLength(0);
  });
});
