import { eq, sql } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { allotmentSlots, offers, providers } from '../../db/schema/offers';
import { orderEvents, orders, paymentAttempts } from '../../db/schema/orders';
import { pendingActions } from '../../db/schema/pending-actions';
import { createJobQueue, ensureQueues, type JobQueue, QUEUES } from '../../jobs/queue';
import { createOrder, type OrderDeps } from '../../orders/machine';
import type { OrderPaymentJobData } from '../../payments/enqueue';
import { applyStripeEvent, parseStripeEvent } from '../../payments/events';
import { type PaymentDeps, runPaymentJob } from '../../payments/jobs';
import { CHECKOUT_HOLD_MINUTES, type PaymentOperation } from '../../payments/vocabulary';
import {
  createTestDatabase,
  fakePaymentGateway,
  type SeededGuestUnit,
  seedGuestUnit,
  seedOrderableOffer,
  seedProvider,
  type TestDatabase,
} from '../../testing';
import { confirmHeldOrder } from '../adapters';
import { CancelRuleError, completeCancel, getPendingCancel, prepareCancel } from './cancel-order';
import { releasePending } from './create-order';

// The cancel_order halves (35): the refund from the snapshotted rules on the card, recomputed at
// the tap, then the machine's cancel and the payment job's refund against the fake Stripe.

let testDb: TestDatabase;
let boss: PgBoss;
let queue: JobQueue;
let guest: SeededGuestUnit;
let neighbour: SeededGuestUnit;

const NOW = new Date('2027-05-01T10:00:00Z');
// seedGuestUnit: check-in 2027-05-03, three nights, checkout 2027-05-06.
const DAY = '2027-05-04';
const SLOT_AT = new Date('2027-05-04T07:00:00Z'); // 09:00 in Zagreb
const CUTOFF = new Date('2027-05-03T07:00:00Z'); // 24 h before
const HOLD_UNTIL = new Date(NOW.getTime() + CHECKOUT_HOLD_MINUTES * 60_000);
const MINUTE = 60_000;

let clock = NOW;
const deps = (): OrderDeps => ({ db: testDb.db, queue, now: () => clock });

beforeAll(async () => {
  testDb = await createTestDatabase();
  boss = new PgBoss({ connectionString: testDb.url, supervise: false, schedule: false });
  boss.on('error', console.error);
  await boss.start();
  await ensureQueues(boss);
  queue = createJobQueue(boss);
  guest = await seedGuestUnit(testDb.db, { now: NOW, spaceLanguage: 'de' });
  neighbour = await seedGuestUnit(testDb.db, { now: NOW });
});

afterAll(async () => {
  await boss?.stop({ graceful: false, timeout: 1000 });
  await testDb?.drop();
});

const ctx = (g: SeededGuestUnit = guest) => ({ spaceId: g.spaceId, language: 'de' as const });

function world() {
  const gateway = fakePaymentGateway({ now: () => clock });
  const pdeps = (): PaymentDeps => ({ ...deps(), gateway, guestOrigin: 'http://guest.test' });
  return { gateway, pdeps };
}
type World = ReturnType<typeof world>;

/** A pay-online allotment Offer of 2 × 25.00 EUR, commission 12.5 %, 24 h free then `percent`. */
async function onlineOffer(percent = 30) {
  const provider = await seedProvider(testDb.db, { commissionBp: 1250 });
  await testDb.db
    .update(providers)
    .set({ stripeAccountId: 'acct_test', stripeCardPayments: 'active' })
    .where(eq(providers.id, provider.id));
  const offer = await seedOrderableOffer(testDb.db, {
    providerId: provider.id,
    availabilityMode: 'allotment',
    paymentMode: 'online',
    priceMinor: 2500,
    capacity: 2,
    startsAt: SLOT_AT,
  });
  await testDb.db
    .update(offers)
    .set({ freeCancelHoursBefore: 24, refundPercentAfter: percent })
    .where(eq(offers.id, offer.offerId));
  return { offerId: offer.offerId, slotId: offer.slotId as string };
}

async function runJobs(w: World, attemptId: string, only?: PaymentOperation[]) {
  const results: string[] = [];
  for (let round = 0; round < 20; round++) {
    const { rows } = await testDb.db.execute<{ id: string; data: OrderPaymentJobData }>(
      sql`select id, data from pgboss.job where name = ${QUEUES.orderPayment} and state = 'created'
          and data->>'attemptId' = ${attemptId} order by created_on, id`,
    );
    const due = rows.filter((r) => !only || only.includes(r.data.operation));
    if (due.length === 0) return results;
    for (const job of due) {
      const { operation, outcome } = await runPaymentJob(w.pdeps(), job.data);
      results.push(`${operation}:${outcome}`);
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

/** A pay-online Order, paid; `captured` (default) or confirmed with the capture still to come. */
async function paidOrder(w: World, options: { percent?: number; capture?: boolean } = {}) {
  clock = NOW;
  const { offerId, slotId } = await onlineOffer(options.percent);
  const { order } = await createOrder(deps(), {
    spaceId: guest.spaceId,
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
  await runJobs(w, attempt.id, ['open']);
  const opened = await attemptOf(attempt.id);
  w.gateway.pay(opened.sessionId as string);
  await deliver(w);
  await runJobs(w, attempt.id, options.capture === false ? ['confirm'] : undefined);
  await deliver(w);
  return { orderId: order.id, attemptId: attempt.id, slotId };
}

async function attemptOf(id: string) {
  const [attempt] = await testDb.db
    .select()
    .from(paymentAttempts)
    .where(eq(paymentAttempts.id, id));
  if (!attempt) throw new Error('no attempt');
  return attempt;
}

async function orderOf(id: string) {
  const [order] = await testDb.db.select().from(orders).where(eq(orders.id, id));
  if (!order) throw new Error('no order');
  return order;
}

async function remaining(slotId: string) {
  const [slot] = await testDb.db.select().from(allotmentSlots).where(eq(allotmentSlots.id, slotId));
  return slot?.remaining;
}

const cancelEvents = async (orderId: string) =>
  (
    await testDb.db
      .select()
      .from(orderEvents)
      .where(eq(orderEvents.orderId, orderId))
      .orderBy(orderEvents.id)
  ).filter((e) => e.toStatus === 'cancelled' && e.fromStatus !== 'cancelled');

async function paymentJobs(attemptId: string): Promise<string[]> {
  const { rows } = await testDb.db.execute<{ operation: string }>(
    sql`select data->>'operation' as operation from pgboss.job where name = ${QUEUES.orderPayment} and data->>'attemptId' = ${attemptId} order by created_on, id`,
  );
  return rows.map((r) => r.operation);
}

async function codeOf(run: Promise<unknown>) {
  try {
    await run;
  } catch (error) {
    if (error instanceof CancelRuleError) return error.code;
    throw error;
  }
  return 'ok';
}

async function guestCancels(orderId: string, g: SeededGuestUnit = guest) {
  const { pendingId, draft } = await prepareCancel(deps(), ctx(g), { orderId });
  return { pendingId, draft, tap: () => completeCancel(deps(), { pendingId, spaceId: g.spaceId }) };
}

describe('cancel_order on a captured Order', () => {
  it('refunds in full before the cutoff, with the fee, and returns the seat', async () => {
    const w = world();
    const { orderId, attemptId, slotId } = await paidOrder(w);
    expect(await orderOf(orderId)).toMatchObject({
      status: 'confirmed',
      paymentStatus: 'captured',
    });
    expect(await remaining(slotId)).toBe(0);

    clock = new Date(CUTOFF.getTime() - MINUTE);
    const { pendingId, draft, tap } = await guestCancels(orderId);
    expect(draft).toMatchObject({
      orderId,
      offerTitle: 'Kayak tour',
      date: DAY,
      startsAtLocal: '2027-05-04T09:00',
      quantity: 2,
      paymentMode: 'online',
      paymentStatus: 'captured',
      priceMinor: 5000,
      currency: 'EUR',
      cancellationPolicy: 'Free until 24 hours before.',
      refundMinor: 5000,
      refundPercent: 100,
      freeUntil: CUTOFF.toISOString(),
      freeUntilLocal: '2027-05-03T09:00',
    });
    const [row] = await testDb.db
      .select()
      .from(pendingActions)
      .where(eq(pendingActions.id, pendingId));
    expect(row).toMatchObject({ kind: 'cancel_order', orderId: null, state: 'pending' });

    const done = await tap();
    expect(done).toMatchObject({
      outcome: 'cancelled',
      replay: false,
      order: { status: 'cancelled', paymentStatus: 'refund_pending', refundMinor: 5000 },
    });
    expect(await remaining(slotId)).toBe(2);
    expect((await attemptOf(attemptId)).refundAmountMinor).toBe(5000);
    const [event] = await cancelEvents(orderId);
    // The cancel, then the refund request: two OrderEvents, both the guest's.
    expect(event).toMatchObject({ trigger: 'guest', toStatus: 'cancelled' });

    expect(await runJobs(w, attemptId)).toEqual(['refund:applied']);
    await deliver(w);
    expect((await orderOf(orderId)).paymentStatus).toBe('refunded');
    expect(w.gateway.calls.find((c) => c.op === 'refund')?.params).toMatchObject({
      amountMinor: 5000,
    });
    expect(w.gateway.state().refunds).toMatchObject([
      { amountMinor: 5000, applicationFeeRefundedMinor: 625, refundApplicationFee: true },
    ]);
  });

  it('refunds the policy percentage after the cutoff, the fee in proportion', async () => {
    const w = world();
    const { orderId, attemptId } = await paidOrder(w);
    clock = new Date(CUTOFF.getTime() + MINUTE);
    const { draft, tap } = await guestCancels(orderId);
    expect(draft).toMatchObject({ refundMinor: 1500, refundPercent: 30 });
    expect((await tap()).outcome).toBe('cancelled');
    expect((await attemptOf(attemptId)).refundAmountMinor).toBe(1500);
    await runJobs(w, attemptId);
    await deliver(w);
    // A partial charge.refunded (refunded: false) still settles the refund.
    expect((await orderOf(orderId)).paymentStatus).toBe('refunded');
    expect(w.gateway.state().refunds).toMatchObject([
      { amountMinor: 1500, applicationFeeRefundedMinor: Math.floor((625 * 1500) / 5000) },
    ]);
  });

  it('re-asks with the new amount when the cutoff passes between card and tap', async () => {
    const w = world();
    const { orderId, attemptId } = await paidOrder(w);
    clock = new Date(CUTOFF.getTime() - MINUTE);
    const { pendingId, draft, tap } = await guestCancels(orderId);
    expect(draft.refundMinor).toBe(5000);

    clock = new Date(CUTOFF.getTime() + MINUTE);
    const changed = await tap();
    expect(changed).toMatchObject({ outcome: 'changed', draft: { refundMinor: 1500 } });
    expect((await orderOf(orderId)).status).toBe('confirmed');
    expect((await getPendingCancel(testDb.db, pendingId, guest.spaceId))?.draft.refundMinor).toBe(
      1500,
    );

    expect((await tap()).outcome).toBe('cancelled');
    expect((await attemptOf(attemptId)).refundAmountMinor).toBe(1500);
  });

  it('refunds nothing under a 0 % rule: cancelled, Payment stays captured, no Stripe call', async () => {
    const w = world();
    const { orderId, attemptId, slotId } = await paidOrder(w, { percent: 0 });
    clock = new Date(CUTOFF.getTime() + MINUTE);
    const { draft, tap } = await guestCancels(orderId);
    expect(draft).toMatchObject({ refundMinor: 0, refundPercent: 0 });
    expect(await tap()).toMatchObject({
      outcome: 'cancelled',
      order: { status: 'cancelled', paymentStatus: 'captured', refundMinor: 0 },
    });
    expect(await remaining(slotId)).toBe(2);
    expect(await attemptOf(attemptId)).toMatchObject({ refundAmountMinor: 0, refundStatus: null });
    expect(await paymentJobs(attemptId)).not.toContain('refund');
    const [event] = await cancelEvents(orderId);
    expect(event).toMatchObject({ toPaymentStatus: 'captured', note: 'refund 0 (policy)' });
  });

  it('is idempotent: a repeated tap and a second card cancel and refund once', async () => {
    const w = world();
    const { orderId, attemptId } = await paidOrder(w);
    const first = await guestCancels(orderId);
    const second = await guestCancels(orderId);
    expect((await first.tap()).outcome).toBe('cancelled');
    expect(await first.tap()).toMatchObject({ outcome: 'cancelled', replay: true });
    expect(await second.tap()).toMatchObject({ outcome: 'cancelled', replay: true });
    expect(await cancelEvents(orderId)).toHaveLength(1);
    expect((await paymentJobs(attemptId)).filter((op) => op === 'refund')).toHaveLength(1);
    await runJobs(w, attemptId);
    expect(w.gateway.state().refunds).toHaveLength(1);
  });
});

describe('cancel_order on other Orders', () => {
  it('voids an authorization that is not captured yet, in full', async () => {
    const w = world();
    const { orderId, attemptId } = await paidOrder(w, { capture: false });
    expect(await orderOf(orderId)).toMatchObject({
      status: 'confirmed',
      paymentStatus: 'authorized',
    });
    const { draft, tap } = await guestCancels(orderId);
    expect(draft).toMatchObject({ refundMinor: 5000, refundPercent: 100, freeUntil: null });
    expect((await tap()).outcome).toBe('cancelled');
    expect(await runJobs(w, attemptId)).toContain('void:applied');
    await deliver(w);
    expect((await orderOf(orderId)).paymentStatus).toBe('voided');
    expect((await attemptOf(attemptId)).refundAmountMinor).toBeNull();
  });

  it('cancels a pay-direct Order with no money lines', async () => {
    clock = NOW;
    const provider = await seedProvider(testDb.db);
    const { offerId, slotId } = await seedOrderableOffer(testDb.db, {
      providerId: provider.id,
      availabilityMode: 'allotment',
      startsAt: SLOT_AT,
    });
    const { order } = await createOrder(deps(), {
      spaceId: guest.spaceId,
      offerId,
      slotId,
      date: DAY,
      quantity: 1,
      contact: { email: 'guest@example.test' },
      hold: { expiresAt: new Date(NOW.getTime() + 15 * MINUTE) },
    });
    await confirmHeldOrder(deps(), {
      orderId: order.id,
      proposalId: order.currentProposalId as string,
    });
    const { draft, tap } = await guestCancels(order.id);
    expect(draft).toMatchObject({ paymentMode: 'direct', refundMinor: null, refundPercent: null });
    expect(await tap()).toMatchObject({
      outcome: 'cancelled',
      order: { status: 'cancelled', paymentStatus: 'none', refundMinor: null },
    });
    const { rows } = await testDb.db.execute<{ kind: string }>(
      sql`select data->>'kind' as kind from pgboss.job where name = ${QUEUES.orderNotify} and data->>'orderId' = ${order.id}`,
    );
    expect(rows.map((r) => r.kind)).toContain('order_cancelled');
  });

  it('re-asks a pay-direct cancel when free cancellation ends between card and tap', async () => {
    clock = NOW;
    const provider = await seedProvider(testDb.db);
    const { offerId, slotId } = await seedOrderableOffer(testDb.db, {
      providerId: provider.id,
      availabilityMode: 'allotment',
      startsAt: SLOT_AT,
    });
    await testDb.db
      .update(offers)
      .set({ freeCancelHoursBefore: 24, refundPercentAfter: 50 })
      .where(eq(offers.id, offerId));
    const { order } = await createOrder(deps(), {
      spaceId: guest.spaceId,
      offerId,
      slotId,
      date: DAY,
      quantity: 1,
      contact: { email: 'guest@example.test' },
      hold: { expiresAt: new Date(NOW.getTime() + 15 * MINUTE) },
    });
    await confirmHeldOrder(deps(), {
      orderId: order.id,
      proposalId: order.currentProposalId as string,
    });
    clock = new Date(CUTOFF.getTime() - MINUTE);
    const { draft, tap } = await guestCancels(order.id);
    expect(draft.cancellation).toEqual({
      freeCancelHoursBefore: 24,
      lateChargePercent: 50,
      freeUntil: CUTOFF.toISOString(),
      freeUntilLocal: '2027-05-03T09:00',
      freeWindowPassed: false,
    });

    clock = new Date(CUTOFF.getTime() + MINUTE);
    expect(await tap()).toMatchObject({
      outcome: 'changed',
      draft: { refundMinor: null, cancellation: { freeWindowPassed: true } },
    });
    expect((await orderOf(order.id)).status).toBe('confirmed');
    expect((await tap()).outcome).toBe('cancelled');
  });

  it('does not re-ask a pay-direct cancel under no late charge when the cutoff passes', async () => {
    clock = NOW;
    const provider = await seedProvider(testDb.db);
    const { offerId, slotId } = await seedOrderableOffer(testDb.db, {
      providerId: provider.id,
      availabilityMode: 'allotment',
      startsAt: SLOT_AT,
    });
    await testDb.db
      .update(offers)
      .set({ freeCancelHoursBefore: 24, refundPercentAfter: 100 })
      .where(eq(offers.id, offerId));
    const { order } = await createOrder(deps(), {
      spaceId: guest.spaceId,
      offerId,
      slotId,
      date: DAY,
      quantity: 1,
      contact: { email: 'guest@example.test' },
      hold: { expiresAt: new Date(NOW.getTime() + 15 * MINUTE) },
    });
    await confirmHeldOrder(deps(), {
      orderId: order.id,
      proposalId: order.currentProposalId as string,
    });
    clock = new Date(CUTOFF.getTime() - MINUTE);
    const { tap } = await guestCancels(order.id);
    clock = new Date(CUTOFF.getTime() + MINUTE);
    expect((await tap()).outcome).toBe('cancelled');
  });

  it("refuses another space's Order, a confirming one, a started one, and after checkout", async () => {
    const w = world();
    const { orderId } = await paidOrder(w);
    expect(await codeOf(prepareCancel(deps(), ctx(neighbour), { orderId }))).toBe('not-found');

    clock = new Date(SLOT_AT.getTime() + MINUTE);
    expect(await codeOf(prepareCancel(deps(), ctx(), { orderId }))).toBe('started');
    clock = new Date('2027-05-07T10:00:00Z');
    expect(await codeOf(prepareCancel(deps(), ctx(), { orderId }))).toBe('after-checkout');

    clock = NOW;
    const { offerId, slotId } = await onlineOffer();
    const { order } = await createOrder(deps(), {
      spaceId: guest.spaceId,
      offerId,
      slotId,
      date: DAY,
      quantity: 1,
      contact: { email: 'guest@example.test' },
      hold: { expiresAt: HOLD_UNTIL },
    });
    expect(order.status).toBe('confirming');
    expect(await codeOf(prepareCancel(deps(), ctx(), { orderId: order.id }))).toBe(
      'being-confirmed',
    );
  });

  it('cancels an unresolved Order after checkout', async () => {
    clock = NOW;
    const provider = await seedProvider(testDb.db);
    const { offerId } = await seedOrderableOffer(testDb.db, {
      providerId: provider.id,
      availabilityMode: 'on_request',
    });
    const { order } = await createOrder(deps(), {
      spaceId: guest.spaceId,
      offerId,
      date: DAY,
      quantity: 1,
      contact: { email: 'guest@example.test' },
    });
    expect(order.status).toBe('pending_provider');
    clock = new Date('2027-05-07T10:00:00Z');
    const { tap } = await guestCancels(order.id);
    expect(await tap()).toMatchObject({ outcome: 'cancelled', order: { status: 'cancelled' } });
  });

  it('refuses a card past its TTL, a declined card, and a cancelled Order', async () => {
    const w = world();
    const { orderId } = await paidOrder(w);
    const late = await guestCancels(orderId);
    clock = new Date(NOW.getTime() + 11 * MINUTE);
    expect(await codeOf(late.tap())).toBe('expired');

    const declined = await guestCancels(orderId);
    await releasePending(testDb.db, {
      pendingId: declined.pendingId,
      spaceId: guest.spaceId,
      now: clock,
    });
    expect(await codeOf(declined.tap())).toBe('released');
    expect((await orderOf(orderId)).status).toBe('confirmed');

    expect((await (await guestCancels(orderId)).tap()).outcome).toBe('cancelled');
    expect(await codeOf(prepareCancel(deps(), ctx(), { orderId }))).toBe('not-cancellable');
  });
});
