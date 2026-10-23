import { eq, sql } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { allotmentSlots, providers } from '../db/schema/offers';
import { inventoryHolds, orderEvents, orders, paymentAttempts } from '../db/schema/orders';
import { createJobQueue, ensureQueues, type JobQueue, QUEUES } from '../jobs/queue';
import { CHECKOUT_HOLD_MINUTES } from '../payments/vocabulary';
import { createTestDatabase, type TestDatabase } from '../testing';
import {
  type SeededGuestUnit,
  seedGuestUnit,
  seedOrderableOffer,
  seedProvider,
} from '../testing/fixtures';
import { createOrder, type OrderDeps } from './machine';
import { authorize } from './payments';
import { expiredHolds, reconcileHold } from './reconcile';

// Holds past expiry resolved by reconciliation (34): through the machine under the Order lock.

let testDb: TestDatabase;
let boss: PgBoss;
let queue: JobQueue;
let unit: SeededGuestUnit;

const NOW = new Date('2027-05-01T10:00:00Z');
const DAY = '2027-05-04';
const SLOT_AT = new Date('2027-05-04T07:00:00Z');
const HOLD_UNTIL = new Date(NOW.getTime() + CHECKOUT_HOLD_MINUTES * 60_000);
const after = (minutes: number) => new Date(HOLD_UNTIL.getTime() + minutes * 60_000);

let clock = NOW;
const deps = (): OrderDeps => ({ db: testDb.db, queue, now: () => clock });

beforeAll(async () => {
  testDb = await createTestDatabase();
  boss = new PgBoss({ connectionString: testDb.url, supervise: false, schedule: false });
  boss.on('error', console.error);
  await boss.start();
  await ensureQueues(boss);
  queue = createJobQueue(boss);
  unit = await seedGuestUnit(testDb.db, { now: NOW });
});

afterAll(async () => {
  await boss?.stop({ graceful: false, timeout: 1000 });
  await testDb?.drop();
});

async function placeOrder(paymentMode: 'direct' | 'online') {
  clock = NOW;
  const provider = await seedProvider(testDb.db, { commissionBp: 1250 });
  await testDb.db
    .update(providers)
    .set({ stripeAccountId: 'acct_test', stripeCardPayments: 'active' })
    .where(eq(providers.id, provider.id));
  const offer = await seedOrderableOffer(testDb.db, {
    providerId: provider.id,
    availabilityMode: 'allotment',
    paymentMode,
    priceMinor: 2500,
    capacity: 2,
    startsAt: SLOT_AT,
  });
  const slotId = offer.slotId as string;
  const { order } = await createOrder(deps(), {
    spaceId: unit.spaceId,
    offerId: offer.offerId,
    slotId,
    date: DAY,
    quantity: 2,
    contact: { email: 'guest@example.test' },
    hold: { expiresAt: HOLD_UNTIL },
  });
  const [hold] = await testDb.db
    .select()
    .from(inventoryHolds)
    .where(eq(inventoryHolds.orderId, order.id));
  if (!hold) throw new Error('no hold');
  return { order, hold, slotId };
}

async function orderOf(id: string) {
  const [order] = await testDb.db.select().from(orders).where(eq(orders.id, id));
  return order;
}

async function holdOf(id: string) {
  const [hold] = await testDb.db.select().from(inventoryHolds).where(eq(inventoryHolds.id, id));
  return hold;
}

async function remaining(slotId: string) {
  const [slot] = await testDb.db.select().from(allotmentSlots).where(eq(allotmentSlots.id, slotId));
  return slot?.remaining;
}

async function jobsOf(name: string, orderId: string, field: 'kind' | 'operation') {
  const { rows } = await testDb.db.execute<{ value: string }>(
    sql`select data->>${field} as value from pgboss.job where name = ${name} and data->>'orderId' = ${orderId} order by created_on, id`,
  );
  return rows.map((r) => r.value);
}

describe('reconcileHold', () => {
  it('expires a pay-direct confirming Order past its hold and the grace, and returns the seats', async () => {
    const { order, hold, slotId } = await placeOrder('direct');
    expect(await remaining(slotId)).toBe(0);
    clock = after(3);
    expect((await expiredHolds(testDb.db, clock, 1000)).map((h) => h.id)).toContain(hold.id);
    expect(await reconcileHold(deps(), hold.id)).toEqual({
      outcome: 'expired',
      orderId: order.id,
      orderStatus: 'confirming',
    });
    expect(await orderOf(order.id)).toMatchObject({ status: 'expired' });
    expect((await holdOf(hold.id))?.state).toBe('released');
    expect(await remaining(slotId)).toBe(2);
    expect(await jobsOf(QUEUES.orderNotify, order.id, 'kind')).toContain('order_expired');
    const [event] = await testDb.db
      .select()
      .from(orderEvents)
      .where(eq(orderEvents.orderId, order.id))
      .orderBy(sql`${orderEvents.id} desc`)
      .limit(1);
    expect(event).toMatchObject({ toStatus: 'expired', trigger: 'reconciliation' });
    // A second look finds nothing left to do.
    expect((await reconcileHold(deps(), hold.id)).outcome).toBe('none');
  });

  it('leaves a hold inside the grace window to its timer', async () => {
    const { order, hold } = await placeOrder('direct');
    clock = after(1);
    expect((await expiredHolds(testDb.db, clock, 1000)).map((h) => h.id)).not.toContain(hold.id);
    expect((await reconcileHold(deps(), hold.id)).outcome).toBe('none');
    expect(await orderOf(order.id)).toMatchObject({ status: 'confirming' });
  });

  it('waits for the confirm job of an authorized Order, then fails it and flags the admin', async () => {
    const { order, hold, slotId } = await placeOrder('online');
    const [attempt] = await testDb.db
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.orderId, order.id));
    if (!attempt) throw new Error('no attempt');
    await authorize(deps(), {
      attemptId: attempt.id,
      paymentIntentId: `pi_${order.id.slice(0, 8)}`,
      trigger: 'payment_job',
    });
    clock = after(10);
    expect((await reconcileHold(deps(), hold.id)).outcome).toBe('waiting');
    expect(await orderOf(order.id)).toMatchObject({ status: 'confirming' });

    clock = after(31);
    expect((await reconcileHold(deps(), hold.id)).outcome).toBe('failed');
    expect(await orderOf(order.id)).toMatchObject({
      status: 'failed',
      paymentStatus: 'authorized',
    });
    expect(await remaining(slotId)).toBe(2);
    const { rows } = await testDb.db.execute<{ operation: string }>(
      sql`select data->>'operation' as operation from pgboss.job where name = ${QUEUES.orderPayment} and data->>'attemptId' = ${attempt.id} order by created_on, id`,
    );
    expect(rows.map((r) => r.operation)).toEqual(['open', 'confirm', 'void']);
    expect((await jobsOf(QUEUES.orderNotify, order.id, 'kind')).sort()).toEqual([
      'admin_payment_attention',
      'order_failed',
    ]);
  });

  it('releases a stray hold on a final Order through the adapter release', async () => {
    const { order, hold, slotId } = await placeOrder('direct');
    await testDb.db.update(orders).set({ status: 'cancelled' }).where(eq(orders.id, order.id));
    clock = after(3);
    expect((await reconcileHold(deps(), hold.id)).outcome).toBe('released');
    expect((await holdOf(hold.id))?.state).toBe('released');
    expect(await remaining(slotId)).toBe(2);
    expect(await orderOf(order.id)).toMatchObject({ status: 'cancelled' });
  });

  it('only reports a held hold on a confirmed Order', async () => {
    const { order, hold, slotId } = await placeOrder('direct');
    await testDb.db.update(orders).set({ status: 'confirmed' }).where(eq(orders.id, order.id));
    clock = after(60);
    expect((await reconcileHold(deps(), hold.id)).outcome).toBe('reported');
    expect((await holdOf(hold.id))?.state).toBe('held');
    expect(await remaining(slotId)).toBe(0);
  });
});
