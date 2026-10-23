import { eq, sql } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { allotmentSlots, providers } from '../db/schema/offers';
import { inventoryHolds, orderEvents, paymentAttempts } from '../db/schema/orders';
import { createJobQueue, ensureQueues, type JobQueue, QUEUES } from '../jobs/queue';
import { CHECKOUT_HOLD_MINUTES } from '../payments/vocabulary';
import { confirmHeldOrder } from '../services/adapters';
import { createTestDatabase, type TestDatabase } from '../testing';
import {
  type SeededGuestUnit,
  seedGuestUnit,
  seedOrderableOffer,
  seedProvider,
} from '../testing/fixtures';
import {
  cancel,
  confirm,
  createOrder,
  type OrderDeps,
  OrderRuleError,
  runOrderTimer,
} from './machine';
import {
  authorize,
  failCheckout,
  flagPaymentAttention,
  recordCaptured,
  recordRefunded,
  recordVoided,
  sessionExpired,
} from './payments';
import { orderJobId } from './timers';

// The machine half of pay-online (33): Payment status, the attempt and the payment jobs the
// transitions enqueue. The Stripe calls themselves are the payment job's (payments/jobs.ts).

let testDb: TestDatabase;
let boss: PgBoss;
let queue: JobQueue;
let unit: SeededGuestUnit;

const NOW = new Date('2027-05-01T10:00:00Z');
const DAY = '2027-05-04';
const SLOT_AT = new Date('2027-05-04T07:00:00Z');
const HOLD_UNTIL = new Date(NOW.getTime() + CHECKOUT_HOLD_MINUTES * 60_000);

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

async function onlineOffer(
  provider: { card?: 'active' | 'pending' | null; account?: string | null } = {},
) {
  const seeded = await seedProvider(testDb.db, { commissionBp: 1250 });
  await testDb.db
    .update(providers)
    .set({
      stripeAccountId: provider.account === undefined ? 'acct_test' : provider.account,
      stripeCardPayments: provider.card === undefined ? 'active' : provider.card,
    })
    .where(eq(providers.id, seeded.id));
  const offer = await seedOrderableOffer(testDb.db, {
    providerId: seeded.id,
    availabilityMode: 'allotment',
    paymentMode: 'online',
    priceMinor: 2500,
    capacity: 2,
    startsAt: SLOT_AT,
  });
  return { offerId: offer.offerId, slotId: offer.slotId as string };
}

async function placeOrder() {
  clock = NOW;
  const { offerId, slotId } = await onlineOffer();
  const { order } = await createOrder(deps(), {
    spaceId: unit.spaceId,
    offerId,
    slotId,
    date: DAY,
    quantity: 2,
    contact: { email: 'guest@example.test' },
    hold: { expiresAt: HOLD_UNTIL },
  });
  const [attempt] = await testDb.db
    .select()
    .from(paymentAttempts)
    .where(eq(paymentAttempts.orderId, order.id));
  if (!attempt) throw new Error('no attempt');
  return { order, attempt, slotId, ref: { orderId: order.id, proposalId: attempt.proposalId } };
}

async function paymentJobs(attemptId: string): Promise<string[]> {
  const { rows } = await testDb.db.execute<{ operation: string }>(
    sql`select data->>'operation' as operation from pgboss.job where name = ${QUEUES.orderPayment} and data->>'attemptId' = ${attemptId} order by created_on, id`,
  );
  return rows.map((r) => r.operation);
}

async function notifyKinds(orderId: string): Promise<string[]> {
  const { rows } = await testDb.db.execute<{ kind: string }>(
    sql`select data->>'kind' as kind from pgboss.job where name = ${QUEUES.orderNotify} and data->>'orderId' = ${orderId} order by created_on, id`,
  );
  return rows.map((r) => r.kind);
}

const events = (orderId: string) =>
  testDb.db
    .select()
    .from(orderEvents)
    .where(eq(orderEvents.orderId, orderId))
    .orderBy(orderEvents.id);

async function attemptOf(id: string) {
  const [attempt] = await testDb.db
    .select()
    .from(paymentAttempts)
    .where(eq(paymentAttempts.id, id));
  if (!attempt) throw new Error('no attempt');
  return attempt;
}

async function remaining(slotId: string) {
  const [slot] = await testDb.db.select().from(allotmentSlots).where(eq(allotmentSlots.id, slotId));
  return slot?.remaining;
}

describe('pay-online createOrder', () => {
  it('stores the attempt with the hold expiry and enqueues the open job', async () => {
    const { order, attempt } = await placeOrder();
    expect(order.status).toBe('confirming');
    expect(order.paymentStatus).toBe('none');
    expect(attempt).toMatchObject({
      proposalVersion: 1,
      stripeAccountId: 'acct_test',
      amountMinor: 5000,
      currency: 'EUR',
      applicationFeeMinor: 625,
      productName: 'Kayak tour',
      createSentAt: null,
      sessionId: null,
      processedEventIds: [],
    });
    const [hold] = await testDb.db
      .select()
      .from(inventoryHolds)
      .where(eq(inventoryHolds.proposalId, attempt.proposalId));
    expect(attempt.expiresAt.getTime()).toBe(HOLD_UNTIL.getTime());
    expect(hold?.expiresAt.getTime()).toBe(HOLD_UNTIL.getTime());
    expect(await paymentJobs(attempt.id)).toEqual(['open']);
    const { rows } = await testDb.db.execute<{ id: string }>(
      sql`select id from pgboss.job where name = ${QUEUES.orderPayment} and data->>'attemptId' = ${attempt.id}`,
    );
    const unix = Math.floor(HOLD_UNTIL.getTime() / 1000);
    expect(rows[0]?.id).toBe(orderJobId(order.id, attempt.proposalId, `payment:open:${unix}`));
  });

  it('refuses a Provider whose card payments are not active, and on-request Offers', async () => {
    clock = NOW;
    const base = { spaceId: unit.spaceId, date: DAY, quantity: 1, contact: { email: 'g@x.test' } };
    for (const provider of [{ card: 'pending' as const }, { card: null }, { account: null }]) {
      const { offerId, slotId } = await onlineOffer(provider);
      await expect(
        createOrder(deps(), { ...base, offerId, slotId, hold: { expiresAt: HOLD_UNTIL } }),
      ).rejects.toEqual(new OrderRuleError('payments-not-ready'));
    }
    const seeded = await seedProvider(testDb.db);
    const onRequest = await seedOrderableOffer(testDb.db, {
      providerId: seeded.id,
      availabilityMode: 'on_request',
      paymentMode: 'online',
    });
    await expect(createOrder(deps(), { ...base, offerId: onRequest.offerId })).rejects.toEqual(
      new OrderRuleError('payment-mode-unsupported'),
    );
  });
});

describe('pay-online happy path', () => {
  it('authorizes, confirms through the adapter, then captures', async () => {
    const { order, attempt, ref } = await placeOrder();

    // Authorization precedes confirmation.
    expect((await confirm(deps(), { ...ref, trigger: 'adapter' })).outcome).toBe('rejected');

    const authorized = await authorize(deps(), {
      attemptId: attempt.id,
      eventId: 'evt_1',
      paymentIntentId: 'pi_1',
      trigger: 'payment_webhook',
    });
    expect(authorized.outcome).toBe('applied');
    expect(authorized.order).toMatchObject({ status: 'confirming', paymentStatus: 'authorized' });
    expect(await attemptOf(attempt.id)).toMatchObject({
      sessionStatus: 'complete',
      intentStatus: 'requires_capture',
      paymentIntentId: 'pi_1',
      processedEventIds: ['evt_1'],
    });
    expect(await paymentJobs(attempt.id)).toEqual(['open', 'confirm']);

    // The same event again, and the other completion event: both unchanged, both recorded.
    const eventsBefore = (await events(order.id)).length;
    const again = {
      attemptId: attempt.id,
      paymentIntentId: 'pi_1',
      trigger: 'payment_webhook' as const,
    };
    expect((await authorize(deps(), { ...again, eventId: 'evt_1' })).outcome).toBe('unchanged');
    expect((await authorize(deps(), { ...again, eventId: 'evt_2' })).outcome).toBe('unchanged');
    expect((await attemptOf(attempt.id)).processedEventIds).toEqual(['evt_1', 'evt_2']);
    expect(await events(order.id)).toHaveLength(eventsBefore);

    const confirmed = await confirmHeldOrder(deps(), ref);
    expect(confirmed.order).toMatchObject({ status: 'confirmed', paymentStatus: 'authorized' });
    expect(await paymentJobs(attempt.id)).toEqual(['open', 'confirm', 'capture']);

    const captured = await recordCaptured(deps(), {
      attemptId: attempt.id,
      trigger: 'payment_job',
    });
    expect(captured.order).toMatchObject({ status: 'confirmed', paymentStatus: 'captured' });
    expect((await attemptOf(attempt.id)).intentStatus).toBe('succeeded');
    // The capture's webhook afterwards is unchanged.
    const late = await recordCaptured(deps(), {
      attemptId: attempt.id,
      eventId: 'evt_3',
      trigger: 'payment_webhook',
    });
    expect(late.outcome).toBe('unchanged');

    expect(
      (await events(order.id)).map((e) => [
        e.fromStatus,
        e.toStatus,
        e.fromPaymentStatus,
        e.toPaymentStatus,
        e.trigger,
      ]),
    ).toEqual([
      [null, 'awaiting_confirmation', null, 'none', 'guest'],
      ['awaiting_confirmation', 'confirming', 'none', 'none', 'guest'],
      ['confirming', 'confirming', 'none', 'authorized', 'payment_webhook'],
      ['confirming', 'confirmed', 'authorized', 'authorized', 'adapter'],
      ['confirmed', 'confirmed', 'authorized', 'captured', 'payment_job'],
    ]);
    // A payment-only change notifies nobody.
    expect((await notifyKinds(order.id)).sort()).toEqual(['order_confirmed', 'provider_confirmed']);
  });

  it("refunds a captured Order in full when the Provider can't fulfil", async () => {
    const { attempt, ref, slotId } = await placeOrder();
    await authorize(deps(), {
      attemptId: attempt.id,
      paymentIntentId: 'pi_r',
      trigger: 'payment_job',
    });
    await confirmHeldOrder(deps(), ref);
    await recordCaptured(deps(), { attemptId: attempt.id, trigger: 'payment_job' });

    const cancelled = await cancel(deps(), { ...ref, trigger: 'provider_link' });
    expect(cancelled.order).toMatchObject({ status: 'cancelled', paymentStatus: 'refund_pending' });
    expect(await remaining(slotId)).toBe(2);
    expect((await attemptOf(attempt.id)).refundStatus).toBe('pending');
    expect(await paymentJobs(attempt.id)).toEqual(['open', 'confirm', 'capture', 'refund']);

    const refunded = await recordRefunded(deps(), {
      attemptId: attempt.id,
      eventId: 'evt_refund',
      trigger: 'payment_webhook',
    });
    expect(refunded.order).toMatchObject({ status: 'cancelled', paymentStatus: 'refunded' });
    expect((await attemptOf(attempt.id)).refundStatus).toBe('succeeded');
  });
});

describe('pay-online releases', () => {
  it('voids an authorization when the Order is cancelled before capture', async () => {
    const { attempt, ref } = await placeOrder();
    await authorize(deps(), {
      attemptId: attempt.id,
      paymentIntentId: 'pi_v',
      trigger: 'payment_job',
    });
    await confirmHeldOrder(deps(), ref);
    const cancelled = await cancel(deps(), { ...ref, trigger: 'provider_link' });
    expect(cancelled.order).toMatchObject({ status: 'cancelled', paymentStatus: 'authorized' });
    expect(await paymentJobs(attempt.id)).toEqual(['open', 'confirm', 'capture', 'void']);

    const voided = await recordVoided(deps(), { attemptId: attempt.id, trigger: 'payment_job' });
    expect(voided.order.paymentStatus).toBe('voided');
    expect(await notifyKinds(ref.orderId)).not.toContain('admin_payment_attention');
  });

  it('refunds a capture that won a race against a cancel', async () => {
    const { attempt, ref } = await placeOrder();
    await authorize(deps(), {
      attemptId: attempt.id,
      paymentIntentId: 'pi_m4',
      trigger: 'payment_job',
    });
    await confirmHeldOrder(deps(), ref);
    await cancel(deps(), { ...ref, trigger: 'admin' });
    // The void job found the intent already captured.
    const captured = await recordCaptured(deps(), {
      attemptId: attempt.id,
      trigger: 'payment_job',
    });
    expect(captured.order).toMatchObject({ status: 'cancelled', paymentStatus: 'refund_pending' });
    expect(await paymentJobs(attempt.id)).toContain('refund');
  });

  it('flags the admin when the authorization is cancelled on a confirmed Order', async () => {
    const { attempt, ref } = await placeOrder();
    await authorize(deps(), {
      attemptId: attempt.id,
      paymentIntentId: 'pi_l',
      trigger: 'payment_job',
    });
    await confirmHeldOrder(deps(), ref);
    const voided = await recordVoided(deps(), {
      attemptId: attempt.id,
      eventId: 'evt_cancel',
      trigger: 'payment_webhook',
    });
    expect(voided.order).toMatchObject({ status: 'confirmed', paymentStatus: 'voided' });
    expect(await notifyKinds(ref.orderId)).toContain('admin_payment_attention');
    expect((await events(ref.orderId)).at(-1)?.note).toBe(
      'authorization cancelled on a confirmed Order',
    );
  });

  it('alerts once per flag, each naming the OrderEvent that says why', async () => {
    const { attempt, ref } = await placeOrder();
    await authorize(deps(), {
      attemptId: attempt.id,
      paymentIntentId: 'pi_f',
      trigger: 'payment_job',
    });
    await confirmHeldOrder(deps(), ref);
    await flagPaymentAttention(deps(), { attemptId: attempt.id, reason: 'capture failed (x)' });
    await recordVoided(deps(), { attemptId: attempt.id, trigger: 'payment_job' });
    const { rows } = await testDb.db.execute<{ eventId: number }>(
      sql`select (data->>'eventId')::bigint as "eventId" from pgboss.job where name = ${QUEUES.orderNotify} and data->>'orderId' = ${ref.orderId} and data->>'kind' = 'admin_payment_attention' order by created_on, id`,
    );
    const notes = new Map((await events(ref.orderId)).map((e) => [Number(e.id), e.note]));
    expect(rows.map((r) => notes.get(Number(r.eventId)))).toEqual([
      'capture failed (x)',
      'authorization cancelled on a confirmed Order',
    ]);
  });

  it('expires with the hold, tells the guest the checkout closed and expires the session', async () => {
    const { order, attempt, slotId, ref } = await placeOrder();
    await testDb.db
      .update(paymentAttempts)
      .set({ createSentAt: NOW, sessionId: 'cs_1', sessionStatus: 'open' })
      .where(eq(paymentAttempts.id, attempt.id));
    clock = new Date(HOLD_UNTIL.getTime() + 1000);
    const expired = await runOrderTimer(deps(), { ...ref, operation: 'hold_expiry' });
    expect(expired.order).toMatchObject({ status: 'expired', paymentStatus: 'none' });
    expect(await remaining(slotId)).toBe(2);
    expect(await notifyKinds(order.id)).toEqual(['order_checkout_expired']);
    expect(await paymentJobs(attempt.id)).toEqual(['open', 'expire_session']);

    // Stripe's expiry afterwards changes nothing but the mirror.
    const webhook = await sessionExpired(deps(), {
      attemptId: attempt.id,
      eventId: 'evt_exp',
      trigger: 'payment_webhook',
    });
    expect(webhook.outcome).toBe('unchanged');
    expect((await attemptOf(attempt.id)).sessionStatus).toBe('expired');
  });

  it('expires the Order on the session-expired webhook before the hold timer', async () => {
    const { attempt, ref, slotId } = await placeOrder();
    const result = await sessionExpired(deps(), {
      attemptId: attempt.id,
      eventId: 'evt_exp2',
      trigger: 'payment_webhook',
    });
    expect(result.order.status).toBe('expired');
    expect(await remaining(slotId)).toBe(2);
    expect((await events(ref.orderId)).at(-1)?.trigger).toBe('payment_webhook');
    clock = new Date(HOLD_UNTIL.getTime() + 1000);
    const timer = await runOrderTimer(deps(), { ...ref, operation: 'hold_expiry' });
    expect(timer.outcome).toBe('stale');
  });

  it('voids a checkout completed after the hold expired, and the Order stays expired', async () => {
    const { attempt, ref } = await placeOrder();
    clock = new Date(HOLD_UNTIL.getTime() + 1000);
    await runOrderTimer(deps(), { ...ref, operation: 'hold_expiry' });
    const late = await authorize(deps(), {
      attemptId: attempt.id,
      eventId: 'evt_late',
      paymentIntentId: 'pi_late',
      trigger: 'payment_webhook',
    });
    expect(late.order).toMatchObject({ status: 'expired', paymentStatus: 'authorized' });
    expect(await paymentJobs(attempt.id)).toEqual(['open', 'void']);
    const voided = await recordVoided(deps(), { attemptId: attempt.id, trigger: 'payment_job' });
    expect(voided.order).toMatchObject({ status: 'expired', paymentStatus: 'voided' });
  });

  it('expires and voids a checkout completed after the hold lapsed, before its timer ran', async () => {
    const { attempt, ref, slotId } = await placeOrder();
    clock = new Date(HOLD_UNTIL.getTime() + 1000);
    const late = await authorize(deps(), {
      attemptId: attempt.id,
      paymentIntentId: 'pi_lapse',
      trigger: 'payment_webhook',
      completedAt: clock,
    });
    expect(late.order).toMatchObject({ status: 'expired', paymentStatus: 'authorized' });
    expect(await paymentJobs(attempt.id)).toEqual(['open', 'void']);
    expect(await notifyKinds(ref.orderId)).toContain('order_checkout_expired');
    expect(await remaining(slotId)).toBe(2);
    expect((await runOrderTimer(deps(), { ...ref, operation: 'hold_expiry' })).outcome).toBe(
      'stale',
    );
  });

  it('confirms a checkout completed in time whose webhook lands after the hold expiry', async () => {
    const { attempt, ref } = await placeOrder();
    clock = new Date(HOLD_UNTIL.getTime() + 2000);
    const paid = await authorize(deps(), {
      attemptId: attempt.id,
      eventId: 'evt_in_time',
      paymentIntentId: 'pi_in_time',
      trigger: 'payment_webhook',
      completedAt: new Date(HOLD_UNTIL.getTime() - 5000),
    });
    expect(paid.order).toMatchObject({ status: 'confirming', paymentStatus: 'authorized' });
    expect(await paymentJobs(attempt.id)).toEqual(['open', 'confirm']);
    // The hold timer leaves it to the confirm job, which still finds the hold.
    expect((await runOrderTimer(deps(), { ...ref, operation: 'hold_expiry' })).outcome).toBe(
      'stale',
    );
    const confirmed = await confirmHeldOrder(deps(), ref);
    expect(confirmed.order).toMatchObject({ status: 'confirmed', paymentStatus: 'authorized' });
    expect(await notifyKinds(ref.orderId)).not.toContain('order_checkout_expired');
  });

  it('fails the Order and flags the admin when the checkout cannot be offered', async () => {
    const { attempt, ref, slotId } = await placeOrder();
    const failed = await failCheckout(deps(), {
      attemptId: attempt.id,
      reason: 'non-card method klarna',
    });
    expect(failed.order).toMatchObject({ status: 'failed', paymentStatus: 'none' });
    expect(await remaining(slotId)).toBe(2);
    expect((await notifyKinds(ref.orderId)).sort()).toEqual([
      'admin_payment_attention',
      'order_failed',
    ]);
    expect((await events(ref.orderId)).at(-1)).toMatchObject({
      trigger: 'payment_job',
      note: 'non-card method klarna',
    });
  });
});
