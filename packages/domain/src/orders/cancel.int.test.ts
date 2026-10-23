import { eq, sql } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accounts } from '../db/schema/accounts';
import { allotmentSlots, providers } from '../db/schema/offers';
import { orderEvents, orders, paymentAttempts } from '../db/schema/orders';
import { createJobQueue, ensureQueues, type JobQueue, QUEUES } from '../jobs/queue';
import type { OrderPaymentJobData } from '../payments/enqueue';
import { applyStripeEvent, parseStripeEvent } from '../payments/events';
import { type PaymentDeps, runPaymentJob } from '../payments/jobs';
import { CHECKOUT_HOLD_MINUTES } from '../payments/vocabulary';
import type { ProposalRef, ProviderAdapter } from '../services/adapters/interface';
import { cannotFulfil } from '../services/provider-link/link';
import {
  createTestDatabase,
  fakePaymentGateway,
  type SeededGuestUnit,
  seedGuestUnit,
  seedOrderableOffer,
  seedProvider,
  type TestDatabase,
} from '../testing';
import { adminCancel, adminRefund, runAdapterCancel } from './cancel';
import { confirm, createOrder, type OrderDeps, OrderRuleError } from './machine';

// The admin's cancel and refund, and the live engine's cancel job (35).

let testDb: TestDatabase;
let boss: PgBoss;
let queue: JobQueue;
let guest: SeededGuestUnit;
let adminId: string;

const NOW = new Date('2027-05-01T10:00:00Z');
const DAY = '2027-05-04';
const SLOT_AT = new Date('2027-05-04T07:00:00Z');
const HOLD_UNTIL = new Date(NOW.getTime() + CHECKOUT_HOLD_MINUTES * 60_000);

const deps = (): OrderDeps => ({ db: testDb.db, queue, now: () => NOW });

beforeAll(async () => {
  testDb = await createTestDatabase();
  boss = new PgBoss({ connectionString: testDb.url, supervise: false, schedule: false });
  boss.on('error', console.error);
  await boss.start();
  await ensureQueues(boss);
  queue = createJobQueue(boss);
  guest = await seedGuestUnit(testDb.db, { now: NOW });
  const [admin] = await testDb.db
    .insert(accounts)
    .values({ email: 'admin@example.test', passwordHash: 'x', role: 'admin' })
    .returning();
  adminId = admin?.id as string;
});

afterAll(async () => {
  await boss?.stop({ graceful: false, timeout: 1000 });
  await testDb?.drop();
});

function world() {
  const gateway = fakePaymentGateway({ now: () => NOW });
  const pdeps = (): PaymentDeps => ({ ...deps(), gateway, guestOrigin: 'http://guest.test' });
  return { gateway, pdeps };
}
type World = ReturnType<typeof world>;

async function runJobs(w: World, attemptId: string) {
  for (let round = 0; round < 20; round++) {
    const { rows } = await testDb.db.execute<{ id: string; data: OrderPaymentJobData }>(
      sql`select id, data from pgboss.job where name = ${QUEUES.orderPayment} and state = 'created'
          and data->>'attemptId' = ${attemptId} order by created_on, id`,
    );
    if (rows.length === 0) return;
    for (const job of rows) {
      await runPaymentJob(w.pdeps(), job.data);
      await testDb.db.execute(sql`update pgboss.job set state = 'completed' where id = ${job.id}`);
    }
  }
  throw new Error('payment jobs kept coming');
}

async function deliver(w: World) {
  for (const event of w.gateway.takeEvents()) {
    await applyStripeEvent(deps(), parseStripeEvent(event));
  }
}

/** A confirmed, captured pay-online Order of 5000 cents, commission 625. */
async function capturedOrder(w: World) {
  const provider = await seedProvider(testDb.db, { commissionBp: 1250 });
  await testDb.db
    .update(providers)
    .set({ stripeAccountId: 'acct_test', stripeCardPayments: 'active' })
    .where(eq(providers.id, provider.id));
  const { offerId, slotId } = await seedOrderableOffer(testDb.db, {
    providerId: provider.id,
    availabilityMode: 'allotment',
    paymentMode: 'online',
    priceMinor: 2500,
    startsAt: SLOT_AT,
  });
  const { order } = await createOrder(deps(), {
    spaceId: guest.spaceId,
    offerId,
    slotId,
    date: DAY,
    quantity: 2,
    contact: { email: 'guest@example.test' },
    hold: { expiresAt: HOLD_UNTIL },
  });
  const attempt = await attemptOf(order.id);
  await runJobs(w, attempt.id);
  w.gateway.pay((await attemptOf(order.id)).sessionId as string);
  await deliver(w);
  await runJobs(w, attempt.id);
  await deliver(w);
  return { orderId: order.id, attemptId: attempt.id, slotId: slotId as string };
}

async function attemptOf(orderId: string) {
  const [attempt] = await testDb.db
    .select()
    .from(paymentAttempts)
    .where(eq(paymentAttempts.orderId, orderId));
  if (!attempt) throw new Error('no attempt');
  return attempt;
}

async function orderOf(id: string) {
  const [order] = await testDb.db.select().from(orders).where(eq(orders.id, id));
  if (!order) throw new Error('no order');
  return order;
}

const eventsOf = (orderId: string) =>
  testDb.db
    .select()
    .from(orderEvents)
    .where(eq(orderEvents.orderId, orderId))
    .orderBy(orderEvents.id);

describe('adminCancel', () => {
  it('refunds the override amount and records it on the OrderEvent', async () => {
    const w = world();
    const { orderId, attemptId } = await capturedOrder(w);
    expect((await orderOf(orderId)).paymentStatus).toBe('captured');
    const result = await adminCancel(deps(), {
      orderId,
      actorId: adminId,
      refundMinor: 1234,
      note: 'goodwill',
    });
    expect(result.outcome).toBe('applied');
    expect(result.order).toMatchObject({ status: 'cancelled', paymentStatus: 'refund_pending' });
    const cancelled = (await eventsOf(orderId)).find((e) => e.toStatus === 'cancelled');
    expect(cancelled).toMatchObject({
      trigger: 'admin',
      actorId: adminId,
      note: 'refund override: 12.34 of 50.00 EUR; goodwill',
    });
    expect((await attemptOf(orderId)).refundAmountMinor).toBe(1234);
    await runJobs(w, attemptId);
    await deliver(w);
    expect((await orderOf(orderId)).paymentStatus).toBe('refunded');
    expect(w.gateway.state().refunds).toMatchObject([
      { amountMinor: 1234, applicationFeeRefundedMinor: Math.floor((625 * 1234) / 5000) },
    ]);
  });

  it('refunds in full without an override, and refuses one above the amount', async () => {
    const w = world();
    const { orderId } = await capturedOrder(w);
    await expect(
      adminCancel(deps(), { orderId, actorId: adminId, refundMinor: 5001 }),
    ).rejects.toEqual(new OrderRuleError('invalid-input'));
    expect((await orderOf(orderId)).status).toBe('confirmed');
    expect((await adminCancel(deps(), { orderId, actorId: adminId })).outcome).toBe('applied');
    expect((await attemptOf(orderId)).refundAmountMinor).toBe(5000);
  });

  it('refuses an override on an authorization, which is voided in full', async () => {
    const w = world();
    const { orderId } = await capturedOrder(w);
    // Back to before the capture: the money is only authorized.
    await testDb.db
      .update(orders)
      .set({ paymentStatus: 'authorized' })
      .where(eq(orders.id, orderId));
    await expect(
      adminCancel(deps(), { orderId, actorId: adminId, refundMinor: 1000 }),
    ).rejects.toEqual(new OrderRuleError('invalid-input'));
    expect((await orderOf(orderId)).status).toBe('confirmed');
  });
});

describe('adminRefund', () => {
  it('refunds a cancelled Order whose money stayed captured, once', async () => {
    const w = world();
    const { orderId, attemptId } = await capturedOrder(w);
    expect(
      (await adminRefund(deps(), { orderId, actorId: adminId, refundMinor: 2000 })).outcome,
    ).toBe('rejected');

    await adminCancel(deps(), { orderId, actorId: adminId, refundMinor: 0 });
    expect(await orderOf(orderId)).toMatchObject({
      status: 'cancelled',
      paymentStatus: 'captured',
    });
    expect((await attemptOf(orderId)).refundAmountMinor).toBe(0);

    const refunded = await adminRefund(deps(), {
      orderId,
      actorId: adminId,
      refundMinor: 2000,
      note: 'dispute',
    });
    expect(refunded).toMatchObject({
      outcome: 'applied',
      order: { paymentStatus: 'refund_pending' },
    });
    expect((await eventsOf(orderId)).at(-1)).toMatchObject({
      trigger: 'admin',
      actorId: adminId,
      note: 'admin refund: 20.00 of 50.00 EUR; dispute',
    });
    expect((await attemptOf(orderId)).refundAmountMinor).toBe(2000);
    expect(
      (await adminRefund(deps(), { orderId, actorId: adminId, refundMinor: 1000 })).outcome,
    ).toBe('rejected');
    await runJobs(w, attemptId);
    expect(w.gateway.state().refunds).toMatchObject([{ amountMinor: 2000 }]);
  });
});

describe('the live engine cancel', () => {
  it('is enqueued with the cancel and calls the adapter once the Order is cancelled', async () => {
    const provider = await seedProvider(testDb.db);
    const { offerId } = await seedOrderableOffer(testDb.db, {
      providerId: provider.id,
      availabilityMode: 'live',
    });
    const { order } = await createOrder(deps(), {
      spaceId: guest.spaceId,
      offerId,
      date: DAY,
      quantity: 1,
      contact: { email: 'guest@example.test' },
      hold: { expiresAt: new Date(NOW.getTime() + 15 * 60_000), externalRef: 'bk-hold' },
    });
    const ref = { orderId: order.id, proposalId: order.currentProposalId as string };
    const calls: ProposalRef[] = [];
    const fake = { cancel: async (_ctx: unknown, r: ProposalRef) => void calls.push(r) };
    const adapters = () => fake as unknown as ProviderAdapter;

    expect(await runAdapterCancel(deps(), ref, adapters)).toBe('stale');
    await confirm(deps(), { ...ref, trigger: 'adapter' });
    expect((await adminCancel(deps(), { orderId: order.id, actorId: adminId })).outcome).toBe(
      'applied',
    );
    const { rows } = await testDb.db.execute<{ data: typeof ref }>(
      sql`select data from pgboss.job where name = ${QUEUES.orderAdapterCancel} and data->>'orderId' = ${order.id}`,
    );
    expect(rows.map((r) => r.data)).toEqual([ref]);
    expect(await runAdapterCancel(deps(), ref, adapters)).toBe('applied');
    expect(calls).toEqual([ref]);
  });
});

async function remaining(slotId: string) {
  const [slot] = await testDb.db.select().from(allotmentSlots).where(eq(allotmentSlots.id, slotId));
  return slot?.remaining;
}

describe("Provider can't fulfil", () => {
  it('refunds the capture in full, returns the seats and alerts the admin', async () => {
    const w = world();
    const { orderId, attemptId, slotId } = await capturedOrder(w);
    const before = await remaining(slotId);
    const order = await orderOf(orderId);
    const result = await cannotFulfil(deps(), {
      orderId,
      proposalId: order.currentProposalId as string,
    });
    expect(result).toMatchObject({
      outcome: 'applied',
      order: { status: 'cancelled', paymentStatus: 'refund_pending' },
    });
    expect((await attemptOf(orderId)).refundAmountMinor).toBe(5000);
    expect(await remaining(slotId)).toBe((before ?? 0) + 2);
    const { rows } = await testDb.db.execute<{ kind: string }>(
      sql`select data->>'kind' as kind from pgboss.job where name = ${QUEUES.orderNotify} and data->>'orderId' = ${orderId}`,
    );
    expect(rows.map((r) => r.kind)).toContain('admin_provider_cancelled');

    await runJobs(w, attemptId);
    await deliver(w);
    expect(w.gateway.state().refunds).toMatchObject([
      { amountMinor: 5000, applicationFeeRefundedMinor: 625 },
    ]);
    expect((await orderOf(orderId)).paymentStatus).toBe('refunded');
  });
});

describe('the refund job', () => {
  it('run twice makes one Stripe refund: same key, same amount', async () => {
    const w = world();
    const { orderId, attemptId } = await capturedOrder(w);
    await adminCancel(deps(), { orderId, actorId: adminId, refundMinor: 3000 });
    const { rows } = await testDb.db.execute<{ data: OrderPaymentJobData }>(
      sql`select data from pgboss.job where name = ${QUEUES.orderPayment} and state = 'created'
          and data->>'attemptId' = ${attemptId} and data->>'operation' = 'refund'`,
    );
    const job = rows[0]?.data;
    if (!job) throw new Error('no refund job');
    // A retry after a lost response replays the same request.
    await runPaymentJob(w.pdeps(), job);
    await runPaymentJob(w.pdeps(), job);
    expect(w.gateway.state().refunds).toMatchObject([{ amountMinor: 3000 }]);
  });
});
