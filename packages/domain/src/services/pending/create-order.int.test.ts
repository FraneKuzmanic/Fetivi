import { eq, sql } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { allotmentSlots } from '../../db/schema/offers';
import { inventoryHolds, orders } from '../../db/schema/orders';
import { pendingActions } from '../../db/schema/pending-actions';
import { spaces } from '../../db/schema/spaces';
import { createJobQueue, ensureQueues, type JobQueue, QUEUES } from '../../jobs/queue';
import type { GuestOfferScope } from '../../offers/guest';
import { createOrder, type OrderDeps } from '../../orders/machine';
import {
  createTestDatabase,
  publishOffer,
  type SeededGuestUnit,
  seedDestination,
  seedGuestUnit,
  seedOrderableOffer,
  seedProvider,
  type TestDatabase,
} from '../../testing';
import {
  availabilityFor,
  completeOrder,
  listSpaceOrders,
  prepareOrder,
  releasePendingOrder,
  ServiceRuleError,
} from './create-order';
import { markPending } from './store';

let testDb: TestDatabase;
let boss: PgBoss;
let queue: JobQueue;
let guest: SeededGuestUnit;
let neighbour: SeededGuestUnit;
let destinationId: string;

const NOW = new Date('2027-05-01T10:00:00Z');
// seedGuestUnit: check-in two days after NOW, three nights.
const DAY = '2027-05-04';
const AT_09 = new Date('2027-05-04T07:00:00Z'); // 09:00 in Zagreb
const AT_15 = new Date('2027-05-04T13:00:00Z');
const CONTACT = { email: ' guest@example.test ', name: 'Ana', phone: '+385 91 000' };

let clock = NOW;
const deps = (): OrderDeps => ({ db: testDb.db, queue, now: () => clock });
const scope = (g: SeededGuestUnit = guest): GuestOfferScope => ({
  destinationId,
  propertyId: g.propertyId,
  language: 'de',
});
const ctx = (g: SeededGuestUnit = guest) => ({ spaceId: g.spaceId, offerScope: scope(g) });

async function allotment(
  options: { startsAt?: Date; capacity?: number; contactFields?: 'name' | 'phone' } = {},
) {
  const provider = await seedProvider(testDb.db);
  const seeded = await seedOrderableOffer(testDb.db, {
    providerId: provider.id,
    destinationId,
    availabilityMode: 'allotment',
    startsAt: options.startsAt ?? AT_09,
    capacity: options.capacity ?? 4,
    contactFields: options.contactFields ?? 'name',
  });
  await publishOffer(testDb.db, seeded.offerId);
  return { offerId: seeded.offerId, slotId: seeded.slotId as string };
}

async function remaining(slotId: string) {
  const [slot] = await testDb.db.select().from(allotmentSlots).where(eq(allotmentSlots.id, slotId));
  return slot?.remaining;
}
const pendingRow = async (id: string) =>
  (await testDb.db.select().from(pendingActions).where(eq(pendingActions.id, id)))[0];
const ordersOf = (offerId: string) =>
  testDb.db.select().from(orders).where(eq(orders.offerId, offerId));

async function codeOf(run: Promise<unknown>) {
  try {
    await run;
  } catch (error) {
    if (error instanceof ServiceRuleError) return error.code;
    throw error;
  }
  return 'ok';
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  boss = new PgBoss({ connectionString: testDb.url, supervise: false, schedule: false });
  boss.on('error', console.error);
  await boss.start();
  await ensureQueues(boss);
  queue = createJobQueue(boss);
  guest = await seedGuestUnit(testDb.db, { now: NOW, spaceLanguage: 'de' });
  neighbour = await seedGuestUnit(testDb.db, { now: NOW });
  destinationId = await seedDestination(testDb.db);
});

afterAll(async () => {
  await boss?.stop({ graceful: false, timeout: 1000 });
  await testDb?.drop();
});

describe('availabilityFor', () => {
  it('lists the day’s starts with room, in the property’s zone', async () => {
    const { offerId, slotId } = await allotment();
    const result = await availabilityFor(deps(), ctx(), { offerId, date: DAY, quantity: 2 });
    expect(result.starts).toEqual([
      { slotId, startsAt: AT_09.toISOString(), startsAtLocal: '2027-05-04T09:00', remaining: 4 },
    ]);
  });

  it('drops starts that have passed', async () => {
    const { offerId } = await allotment();
    clock = new Date(AT_09.getTime() + 1000);
    try {
      const result = await availabilityFor(deps(), ctx(), { offerId, date: DAY, quantity: 1 });
      expect(result.starts).toEqual([]);
    } finally {
      clock = NOW;
    }
  });
});

describe('prepareOrder', () => {
  it('stores one pending row with the draft and holds nothing', async () => {
    const { offerId, slotId } = await allotment();
    const { pendingId, draft } = await prepareOrder(deps(), ctx(), {
      offerId,
      date: DAY,
      quantity: 2,
    });
    const row = await pendingRow(pendingId);
    expect(row?.state).toBe('pending');
    expect(row?.expiresAt).toEqual(new Date(NOW.getTime() + 600_000));
    expect(draft).toMatchObject({
      offerId,
      offerTitle: '[de] Kayak tour',
      slotId,
      startsAtLocal: '2027-05-04T09:00',
      quantity: 2,
      priceMinor: 5000,
      contactFields: 'name',
    });
    expect(await remaining(slotId)).toBe(4);
  });

  it('refuses what cannot be booked', async () => {
    const { offerId, slotId } = await allotment();
    const at = (input: Partial<{ date: string; quantity: number; slotId: string }>) =>
      codeOf(prepareOrder(deps(), ctx(), { offerId, date: DAY, quantity: 1, ...input }));
    expect(await at({ date: '2027-05-20' })).toBe('date-outside-stay');
    expect(await at({ date: 'tomorrow' })).toBe('invalid-input');
    expect(await at({ quantity: 5 })).toBe('no-availability');
    expect(await at({ quantity: 0 })).toBe('invalid-input');
    expect(await at({ slotId: '00000000-0000-4000-8000-000000000000' })).toBe('no-availability');
    clock = new Date(AT_09.getTime() + 1000);
    try {
      expect(await at({ slotId })).toBe('start-passed');
    } finally {
      clock = NOW;
    }
  });

  it('refuses a past day', async () => {
    const early = await seedGuestUnit(testDb.db, { now: NOW, checkInInDays: -1 });
    const { offerId } = await allotment({ startsAt: new Date('2027-04-30T07:00:00Z') });
    expect(
      await codeOf(prepareOrder(deps(), ctx(early), { offerId, date: '2027-04-30', quantity: 1 })),
    ).toBe('date-past');
  });

  it('asks for a start when the day has several', async () => {
    const { offerId } = await allotment();
    await testDb.db
      .insert(allotmentSlots)
      .values({ offerId, startsAt: AT_15, capacity: 4, remaining: 4 });
    expect(await codeOf(prepareOrder(deps(), ctx(), { offerId, date: DAY, quantity: 1 }))).toBe(
      'choose-start',
    );
  });

  it('refuses on request, live, pay-online and invisible Offers', async () => {
    const provider = await seedProvider(testDb.db);
    const of = async (o: Partial<Parameters<typeof seedOrderableOffer>[1]>) => {
      const { offerId } = await seedOrderableOffer(testDb.db, {
        providerId: provider.id,
        destinationId,
        availabilityMode: 'on_request',
        ...o,
      });
      await publishOffer(testDb.db, offerId);
      return codeOf(prepareOrder(deps(), ctx(), { offerId, date: DAY, quantity: 1 }));
    };
    expect(await of({})).toBe('not-bookable-in-chat');
    expect(await of({ availabilityMode: 'live' })).toBe('not-bookable-in-chat');
    expect(
      await of({ availabilityMode: 'allotment', startsAt: AT_09, paymentMode: 'online' }),
    ).toBe('not-bookable-in-chat');
    const other = await seedOrderableOffer(testDb.db, {
      hostId: neighbour.hostId,
      availabilityMode: 'allotment',
      startsAt: AT_09,
    });
    await publishOffer(testDb.db, other.offerId);
    expect(
      await codeOf(prepareOrder(deps(), ctx(), { offerId: other.offerId, date: DAY, quantity: 1 })),
    ).toBe('offer-not-visible');
  });
});

describe('completeOrder', () => {
  async function prepared(
    options: Parameters<typeof allotment>[0] = {},
    quantity = 2,
  ): Promise<{ offerId: string; slotId: string; pendingId: string }> {
    const offer = await allotment(options);
    const { pendingId } = await prepareOrder(deps(), ctx(), {
      offerId: offer.offerId,
      date: DAY,
      quantity,
    });
    return { ...offer, pendingId };
  }
  const complete = (pendingId: string, g: SeededGuestUnit = guest) =>
    completeOrder(deps(), { pendingId, ...ctx(g), contact: CONTACT });

  it('creates one confirmed Order with only the configured contact fields', async () => {
    const { offerId, slotId, pendingId } = await prepared();
    const { order, replay } = await complete(pendingId);
    expect(replay).toBe(false);
    expect(order).toMatchObject({ offerId, status: 'confirmed', quantity: 2, priceMinor: 5000 });
    expect(order.offerTitle).toBe('[de] Kayak tour');
    const row = await pendingRow(pendingId);
    expect(row?.state).toBe('consumed');
    expect(row?.orderId).toBe(order.id);
    const [stored] = await ordersOf(offerId);
    expect(stored).toMatchObject({ guestEmail: 'guest@example.test', guestName: 'Ana' });
    expect(stored?.guestPhone).toBeNull();
    const [hold] = await testDb.db
      .select()
      .from(inventoryHolds)
      .where(eq(inventoryHolds.orderId, order.id));
    expect(hold?.state).toBe('committed');
    expect(await remaining(slotId)).toBe(2);
  });

  it('a repeat returns the same Order', async () => {
    const { offerId, pendingId } = await prepared();
    const first = await complete(pendingId);
    const second = await complete(pendingId);
    expect(second).toMatchObject({ replay: true, order: { id: first.order.id } });
    expect(await ordersOf(offerId)).toHaveLength(1);
  });

  it('stores the card email on the space with the first opt-in time and queues verification', async () => {
    const g = await seedGuestUnit(testDb.db, { now: NOW });
    const space = async () =>
      (await testDb.db.select().from(spaces).where(eq(spaces.id, g.spaceId)))[0];
    const verifyJobs = async () =>
      (
        await testDb.db.execute(
          sql`select 1 from pgboss.job where name = ${QUEUES.spaceEmail} and data->>'spaceId' = ${g.spaceId} and data->>'purpose' = 'verify_email'`,
        )
      ).rows.length;
    const prepare = async () => {
      const offer = await allotment();
      return (
        await prepareOrder(deps(), ctx(g), { offerId: offer.offerId, date: DAY, quantity: 1 })
      ).pendingId;
    };
    expect((await space())?.email).toBeNull();

    const first = await prepare();
    await completeOrder(deps(), { pendingId: first, ...ctx(g), contact: CONTACT });
    const after = await space();
    expect(after).toMatchObject({
      email: 'guest@example.test',
      emailOptInAt: clock,
      emailVerifiedAt: null,
      updatedAt: clock,
    });
    expect(await verifyJobs()).toBe(1);
    await testDb.db.update(spaces).set({ emailVerifiedAt: clock }).where(eq(spaces.id, g.spaceId));

    // A replay writes nothing.
    const later = new Date(clock.getTime() + 60_000);
    clock = later;
    await completeOrder(deps(), { pendingId: first, ...ctx(g), contact: CONTACT });
    expect((await space())?.updatedAt).toEqual(after?.updatedAt);

    // The same address typed differently is the same address: still verified, no new link.
    const again = await prepare();
    await completeOrder(deps(), {
      pendingId: again,
      ...ctx(g),
      contact: { ...CONTACT, email: 'Guest@Example.test' },
    });
    expect(await space()).toMatchObject({ email: 'guest@example.test', emailVerifiedAt: NOW });
    expect(await verifyJobs()).toBe(1);

    // A later card with a new email replaces it, keeps the opt-in time and needs verifying.
    const second = await prepare();
    await completeOrder(deps(), {
      pendingId: second,
      ...ctx(g),
      contact: { ...CONTACT, email: 'other@example.test' },
    });
    expect(await space()).toMatchObject({
      email: 'other@example.test',
      emailOptInAt: after?.emailOptInAt,
      emailVerifiedAt: null,
      updatedAt: later,
    });
    expect(await verifyJobs()).toBe(2);
    clock = NOW;
  });

  it('concurrent completions make exactly one Order', async () => {
    const { offerId, slotId, pendingId } = await prepared();
    const results = await Promise.all([
      complete(pendingId),
      complete(pendingId),
      complete(pendingId),
    ]);
    expect(new Set(results.map((r) => r.order.id)).size).toBe(1);
    expect(results.filter((r) => !r.replay)).toHaveLength(1);
    const rows = await ordersOf(offerId);
    expect(rows.map((r) => r.status)).toEqual(['confirmed']);
    expect(await remaining(slotId)).toBe(2);
  });

  it('an expired record is released and makes no Order', async () => {
    const { offerId, pendingId } = await prepared();
    clock = new Date(NOW.getTime() + 600_000);
    try {
      expect(await codeOf(complete(pendingId))).toBe('expired');
    } finally {
      clock = NOW;
    }
    expect((await pendingRow(pendingId))?.state).toBe('released');
    expect(await ordersOf(offerId)).toHaveLength(0);
  });

  it('a start that passed between the halves releases the record', async () => {
    clock = new Date(AT_09.getTime() - 5 * 60_000);
    try {
      const { offerId, pendingId } = await prepared();
      // Tapped at 09:02, still inside the ten-minute TTL.
      clock = new Date(AT_09.getTime() + 2 * 60_000);
      expect(await codeOf(complete(pendingId))).toBe('start-passed');
      expect((await pendingRow(pendingId))?.state).toBe('released');
      expect(await ordersOf(offerId)).toHaveLength(0);
    } finally {
      clock = NOW;
    }
  });

  it('another space cannot complete it', async () => {
    const { offerId, pendingId } = await prepared();
    expect(await codeOf(complete(pendingId, neighbour))).toBe('not-found');
    expect((await pendingRow(pendingId))?.state).toBe('pending');
    expect(await ordersOf(offerId)).toHaveLength(0);
  });

  it('seats sold between the halves release the record', async () => {
    const { offerId, slotId, pendingId } = await prepared({ capacity: 2 });
    await testDb.db
      .update(allotmentSlots)
      .set({ remaining: 1 })
      .where(eq(allotmentSlots.id, slotId));
    expect(await codeOf(complete(pendingId))).toBe('no-availability');
    expect((await pendingRow(pendingId))?.state).toBe('released');
    expect(await ordersOf(offerId)).toHaveLength(0);
    expect(await remaining(slotId)).toBe(1);
  });

  it('a missing configured contact field is refused without consuming', async () => {
    const { pendingId } = await prepared({ contactFields: 'phone' });
    const code = await codeOf(
      completeOrder(deps(), { pendingId, ...ctx(), contact: { email: 'a@b.test', name: 'Ana' } }),
    );
    expect(code).toBe('invalid-input');
    expect((await pendingRow(pendingId))?.state).toBe('pending');
  });

  it('a released record cannot be completed', async () => {
    const { offerId, pendingId } = await prepared();
    expect(
      await releasePendingOrder(testDb.db, { pendingId, spaceId: guest.spaceId, now: NOW }),
    ).toBe('released');
    expect(await codeOf(complete(pendingId))).toBe('released');
    expect(await ordersOf(offerId)).toHaveLength(0);
  });

  it('release is owner-only', async () => {
    const { pendingId } = await prepared();
    expect(
      await releasePendingOrder(testDb.db, { pendingId, spaceId: neighbour.spaceId, now: NOW }),
    ).toBeNull();
    expect((await pendingRow(pendingId))?.state).toBe('pending');
  });

  it('a replay finishes a commit an earlier call lost', async () => {
    const { offerId, pendingId } = await prepared();
    const row = await pendingRow(pendingId);
    if (!row?.orderId) throw new Error('no row');
    // The first call created the Order and consumed the record, then lost the adapter commit.
    await createOrder(deps(), {
      id: row.orderId,
      spaceId: guest.spaceId,
      offerId,
      date: DAY,
      slotId: (row.payload as { slotId: string }).slotId,
      quantity: 2,
      contact: { email: 'guest@example.test', name: 'Ana' },
      hold: { expiresAt: new Date(NOW.getTime() + 900_000) },
    });
    await markPending(testDb.db, pendingId, 'consumed', NOW);
    expect((await ordersOf(offerId))[0]?.status).toBe('confirming');
    const { order, replay } = await complete(pendingId);
    expect(replay).toBe(true);
    expect(order.status).toBe('confirmed');
  });
});

describe('listSpaceOrders', () => {
  it('lists only the space’s Orders, newest first', async () => {
    const list = await listSpaceOrders(testDb.db, guest.spaceId, 'de');
    expect(list.length).toBeGreaterThan(1);
    const created = list.map((o) => o.createdAt);
    expect([...created].sort().reverse()).toEqual(created);
    expect(list.every((o) => o.offerTitle.startsWith('[de] '))).toBe(true);
    expect(await listSpaceOrders(testDb.db, neighbour.spaceId, 'en')).toEqual([]);
    const { rows } = await testDb.db.execute<{ n: number }>(
      sql`select count(*)::int as n from orders where space_id = ${guest.spaceId}`,
    );
    expect(list).toHaveLength(rows[0]?.n ?? -1);
  });
});
