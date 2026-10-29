import { eq, sql } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accounts } from '../db/schema/accounts';
import { allotmentSlots, providers } from '../db/schema/offers';
import { inventoryHolds, orderEvents, orders, paymentAttempts } from '../db/schema/orders';
import { createJobQueue, ensureQueues, type JobQueue, QUEUES } from '../jobs/queue';
import type { GuestOfferScope } from '../offers/guest';
import { cancel, createOrder, expire, type OrderDeps, runOrderTimer } from '../orders/machine';
import { orderJobId } from '../orders/timers';
import {
  availabilityFor,
  completeOrder,
  listSpaceOrders,
  prepareOrder,
  ServiceRuleError,
} from '../services/pending/create-order';
import {
  createTestDatabase,
  type FakeStripeOptions,
  fakePaymentGateway,
  publishOffer,
  type SeededGuestUnit,
  seedDestination,
  seedGuestUnit,
  seedOrderableOffer,
  seedProvider,
  type TestDatabase,
} from '../testing';
import { checkoutFor } from './checkout';
import type { OrderPaymentJobData } from './enqueue';
import { applyStripeEvent, parseStripeEvent } from './events';
import { type PaymentDeps, type PaymentJobResult, runPaymentJob } from './jobs';
import {
  disconnectHostPayments,
  hostOnboardingLink,
  OnboardingRuleError,
  providerOnboardingLink,
  refreshHostPayments,
  refreshProviderPayments,
} from './onboarding';
import { CHECKOUT_HOLD_MINUTES, type PaymentOperation } from './vocabulary';

// The external half of pay-online (33): the payment job against a fake Stripe that behaves like
// Stripe on idempotency, the webhook mapping, and the guest-facing checkout state.

let testDb: TestDatabase;
let boss: PgBoss;
let queue: JobQueue;
let guest: SeededGuestUnit;
let destinationId: string;

const NOW = new Date('2027-05-01T10:00:00Z');
const DAY = '2027-05-04';
const SLOT_AT = new Date('2027-05-04T07:00:00Z');
const HOLD_UNTIL = new Date(NOW.getTime() + CHECKOUT_HOLD_MINUTES * 60_000);
const GUEST_ORIGIN = 'http://guest.test';
const unix = (d: Date) => Math.floor(d.getTime() / 1000);
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

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
  destinationId = await seedDestination(testDb.db);
});

afterAll(async () => {
  await boss?.stop({ graceful: false, timeout: 1000 });
  await testDb?.drop();
});

const scope = (): GuestOfferScope => ({
  destinationId,
  propertyId: guest.propertyId,
  language: 'de',
});

function world(options: FakeStripeOptions = {}) {
  const gateway = fakePaymentGateway({ now: () => clock, ...options });
  const pdeps = (): PaymentDeps => ({ ...deps(), gateway, guestOrigin: GUEST_ORIGIN });
  return { gateway, pdeps };
}

async function onlineOffer(
  options: { card?: 'active' | 'pending'; availabilityMode?: 'allotment' | 'on_request' } = {},
) {
  const provider = await seedProvider(testDb.db, { commissionBp: 1250 });
  await testDb.db
    .update(providers)
    .set({ stripeAccountId: 'acct_test', stripeCardPayments: options.card ?? 'active' })
    .where(eq(providers.id, provider.id));
  const mode = options.availabilityMode ?? 'allotment';
  const offer = await seedOrderableOffer(testDb.db, {
    providerId: provider.id,
    destinationId,
    availabilityMode: mode,
    paymentMode: 'online',
    priceMinor: 2500,
    capacity: 2,
    startsAt: mode === 'allotment' ? SLOT_AT : undefined,
    contactFields: 'name',
  });
  await publishOffer(testDb.db, offer.offerId);
  return { offerId: offer.offerId, slotId: offer.slotId as string };
}

async function placeOrder() {
  clock = NOW;
  const { offerId, slotId } = await onlineOffer();
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
  return { order, attempt, slotId, ref: { orderId: order.id, proposalId: attempt.proposalId } };
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

async function notifyKinds(orderId: string): Promise<string[]> {
  const { rows } = await testDb.db.execute<{ kind: string }>(
    sql`select data->>'kind' as kind from pgboss.job where name = ${QUEUES.orderNotify} and data->>'orderId' = ${orderId} order by created_on, id`,
  );
  return rows.map((r) => r.kind);
}

/**
 * Plays the pg-boss worker for one attempt's payment jobs, oldest first, until none is due (or
 * only `only` operations). A job that throws stays due, like a pg-boss retry.
 */
async function runJobs(
  pdeps: () => PaymentDeps,
  attemptId: string,
  only?: PaymentOperation[],
): Promise<PaymentJobResult[]> {
  const results: PaymentJobResult[] = [];
  for (let round = 0; round < 20; round++) {
    const { rows } = await testDb.db.execute<{ id: string; data: OrderPaymentJobData }>(
      sql`select id, data from pgboss.job where name = ${QUEUES.orderPayment} and state = 'created'
          and data->>'attemptId' = ${attemptId} order by created_on, id`,
    );
    const due = rows.filter((r) => !only || only.includes(r.data.operation));
    if (due.length === 0) return results;
    for (const job of due) {
      results.push(await runPaymentJob(pdeps(), job.data));
      await testDb.db.execute(sql`update pgboss.job set state = 'completed' where id = ${job.id}`);
    }
  }
  throw new Error('payment jobs kept coming');
}

async function deliver(gateway: ReturnType<typeof world>['gateway']) {
  const outcomes: string[] = [];
  for (const event of gateway.takeEvents()) {
    outcomes.push(await applyStripeEvent(deps(), parseStripeEvent(event)));
  }
  return outcomes;
}

const paymentTrail = async (orderId: string) =>
  (
    await testDb.db
      .select()
      .from(orderEvents)
      .where(eq(orderEvents.orderId, orderId))
      .orderBy(orderEvents.id)
  )
    .filter((e) => e.fromPaymentStatus !== null && e.fromPaymentStatus !== e.toPaymentStatus)
    .map((e) => `${e.fromPaymentStatus}>${e.toPaymentStatus}`);

/** Places an Order, opens its checkout and has the guest pay; returns once `authorized`. */
async function authorized(w: ReturnType<typeof world>) {
  const placed = await placeOrder();
  await runJobs(w.pdeps, placed.attempt.id, ['open']);
  const { sessionId } = await attemptOf(placed.attempt.id);
  w.gateway.pay(sessionId as string);
  await deliver(w.gateway);
  return placed;
}

describe('the payment job: happy path', () => {
  it('opens the checkout, authorizes, confirms through the adapter, then captures with the fee', async () => {
    const w = world();
    const { order, attempt, slotId } = await placeOrder();

    expect(await runJobs(w.pdeps, attempt.id)).toEqual([{ operation: 'open', outcome: 'applied' }]);
    const [create] = w.gateway.calls;
    expect(create).toMatchObject({
      op: 'create_session',
      account: 'acct_test',
      idempotencyKey: `order:${order.id}:proposal:1:create_session:${unix(HOLD_UNTIL)}`,
      params: {
        clientReferenceId: attempt.id,
        expiresAt: HOLD_UNTIL,
        amountMinor: 5000,
        currency: 'EUR',
        locale: 'de',
        successUrl: `${GUEST_ORIGIN}/trip?checkout=${order.id}`,
        cancelUrl: `${GUEST_ORIGIN}/trip?order=${order.id}`,
        metadata: { fetivi_attempt_id: attempt.id, fetivi_order_id: order.id },
      },
    });
    const opened = await attemptOf(attempt.id);
    expect(opened.createSentAt).toEqual(NOW);
    expect(opened.sessionStatus).toBe('open');
    expect(opened.checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.test\//);

    w.gateway.pay(opened.sessionId as string);
    expect(await deliver(w.gateway)).toEqual(['applied', 'unchanged']);
    expect(await orderOf(order.id)).toMatchObject({
      status: 'confirming',
      paymentStatus: 'authorized',
    });

    expect(await runJobs(w.pdeps, attempt.id)).toEqual([
      { operation: 'confirm', outcome: 'applied' },
      { operation: 'capture', outcome: 'applied' },
    ]);
    const capture = w.gateway.calls.find((c) => c.op === 'capture');
    expect(capture).toMatchObject({
      idempotencyKey: `order:${order.id}:proposal:1:capture:${unix(HOLD_UNTIL)}`,
      params: { applicationFeeAmount: 625 },
    });
    expect(await deliver(w.gateway)).toEqual(['unchanged']);
    expect(await orderOf(order.id)).toMatchObject({
      status: 'confirmed',
      paymentStatus: 'captured',
    });
    expect(await remaining(slotId)).toBe(0);
    expect(await paymentTrail(order.id)).toEqual(['none>authorized', 'authorized>captured']);

    // Fetivi's attempt state equals Stripe's.
    const [session] = w.gateway.state().sessions;
    const [intent] = w.gateway.state().intents;
    expect(await attemptOf(attempt.id)).toMatchObject({
      sessionId: session?.id,
      sessionStatus: session?.status,
      paymentIntentId: intent?.id,
      intentStatus: intent?.status,
    });
    expect(intent?.applicationFeeAmount).toBe(625);
  });
});

describe('webhooks', () => {
  it('processes an event once and accepts reordered completion events', async () => {
    const w = world();
    const { order, attempt } = await placeOrder();
    await runJobs(w.pdeps, attempt.id, ['open']);
    w.gateway.pay((await attemptOf(attempt.id)).sessionId as string);
    const [completed, capturable] = w.gateway.takeEvents();
    if (!completed || !capturable) throw new Error('no events');
    const apply = (e: typeof completed) => applyStripeEvent(deps(), parseStripeEvent(e));

    expect(await apply(capturable)).toBe('applied');
    expect(await apply(completed)).toBe('unchanged');
    expect(await apply(capturable)).toBe('unchanged');
    const after = await attemptOf(attempt.id);
    expect([...after.processedEventIds].sort()).toEqual([capturable.id, completed.id].sort());
    expect(await paymentTrail(order.id)).toEqual(['none>authorized']);
  });

  it('ignores an event from another connected account or for no attempt of ours', async () => {
    const w = world();
    const { attempt } = await placeOrder();
    await runJobs(w.pdeps, attempt.id, ['open']);
    w.gateway.pay((await attemptOf(attempt.id)).sessionId as string);
    const [completed] = w.gateway.takeEvents();
    if (!completed) throw new Error('no event');
    const foreign = { ...completed, account: 'acct_other' };
    expect(await applyStripeEvent(deps(), parseStripeEvent(foreign))).toBe('ignored');
    const stranger = {
      ...completed,
      data: { object: { ...completed.data.object, client_reference_id: 'cs-not-ours' } },
    };
    expect(await applyStripeEvent(deps(), parseStripeEvent(stranger))).toBe('ignored');
    expect((await attemptOf(attempt.id)).processedEventIds).toEqual([]);
  });
});

describe('the open job', () => {
  it('replays the same request after a lost create response: one session', async () => {
    const w = world();
    const { attempt } = await placeOrder();
    w.gateway.failNext('create_session', 'response-lost');
    await expect(runJobs(w.pdeps, attempt.id)).rejects.toMatchObject({ code: 'unavailable' });
    expect((await attemptOf(attempt.id)).sessionId).toBeNull();

    expect(await runJobs(w.pdeps, attempt.id)).toEqual([{ operation: 'open', outcome: 'applied' }]);
    const creates = w.gateway.calls.filter((c) => c.op === 'create_session');
    expect(creates).toHaveLength(2);
    expect(creates[0]).toEqual(creates[1]);
    expect(w.gateway.state().sessions).toHaveLength(1);
    expect((await attemptOf(attempt.id)).sessionId).toBe(w.gateway.state().sessions[0]?.id);
  });

  it('restamps an attempt first sent too late: hold, timer and key move together', async () => {
    const w = world();
    const { order, attempt, ref } = await placeOrder();
    clock = minutes(2);
    const later = new Date(clock.getTime() + CHECKOUT_HOLD_MINUTES * 60_000);

    expect(await runJobs(w.pdeps, attempt.id)).toEqual([
      { operation: 'open', outcome: 'restamped' },
      { operation: 'open', outcome: 'applied' },
    ]);
    const restamped = await attemptOf(attempt.id);
    expect(restamped.expiresAt).toEqual(later);
    const [hold] = await testDb.db
      .select()
      .from(inventoryHolds)
      .where(eq(inventoryHolds.proposalId, ref.proposalId));
    expect(hold?.expiresAt).toEqual(later);
    const creates = w.gateway.calls.filter((c) => c.op === 'create_session');
    expect(creates.map((c) => c.idempotencyKey)).toEqual([
      `order:${order.id}:proposal:1:create_session:${unix(later)}`,
    ]);
    const timerId = orderJobId(ref.orderId, ref.proposalId, `hold_expiry:${unix(later)}`);
    const { rows } = await testDb.db.execute<{ start_after: Date }>(
      sql`select start_after from pgboss.job where id = ${timerId}`,
    );
    expect(new Date(rows[0]?.start_after as Date)).toEqual(later);

    clock = HOLD_UNTIL;
    const timer = { ...ref, operation: 'hold_expiry' } as const;
    expect((await runOrderTimer(deps(), timer)).outcome).toBe('stale');
    clock = later;
    expect((await runOrderTimer(deps(), timer)).outcome).toBe('applied');
    expect((await orderOf(order.id)).status).toBe('expired');
  });

  it('fails the Order when the session offers a non-card method, and expires the session', async () => {
    const w = world({ methods: ['card', 'link', 'klarna'] });
    const { order, attempt, slotId } = await placeOrder();
    expect(await runJobs(w.pdeps, attempt.id)).toEqual([
      { operation: 'open', outcome: 'applied' },
      { operation: 'expire_session', outcome: 'unchanged' },
    ]);
    expect(await orderOf(order.id)).toMatchObject({ status: 'failed', paymentStatus: 'none' });
    expect(await remaining(slotId)).toBe(2);
    expect(await notifyKinds(order.id)).toContain('admin_payment_attention');
    const after = await attemptOf(attempt.id);
    expect(after.checkoutUrl).toBeNull();
    expect(after.sessionStatus).toBe('expired');
    expect(w.gateway.state().sessions[0]?.status).toBe('expired');
  });
});

describe('late and lost checkouts', () => {
  it('voids a checkout paid after the hold expired, found by expire_session', async () => {
    const w = world();
    const { order, attempt, ref } = await placeOrder();
    await runJobs(w.pdeps, attempt.id, ['open']);
    clock = HOLD_UNTIL;
    expect((await runOrderTimer(deps(), { ...ref, operation: 'hold_expiry' })).outcome).toBe(
      'applied',
    );
    expect(await notifyKinds(order.id)).toContain('order_checkout_expired');
    // The guest paid at the last second; the completion webhook is lost.
    w.gateway.pay((await attemptOf(attempt.id)).sessionId as string);
    w.gateway.takeEvents();

    expect(await runJobs(w.pdeps, attempt.id)).toEqual([
      { operation: 'expire_session', outcome: 'applied' },
      { operation: 'void', outcome: 'applied' },
    ]);
    expect(await orderOf(order.id)).toMatchObject({ status: 'expired', paymentStatus: 'voided' });
    expect(await deliver(w.gateway)).toEqual(['unchanged']);
    expect(w.gateway.state().intents[0]?.status).toBe('canceled');
  });

  it('reads the session when Stripe rejects the expire in words it gives no code for', async () => {
    const w = world();
    const { order, attempt, ref } = await placeOrder();
    await runJobs(w.pdeps, attempt.id, ['open']);
    w.gateway.pay((await attemptOf(attempt.id)).sessionId as string);
    w.gateway.takeEvents(); // the completion webhook is lost
    await expire(deps(), { ...ref, trigger: 'admin' });
    w.gateway.failNext('expire_session', 'rejected');
    expect(await runJobs(w.pdeps, attempt.id)).toEqual([
      { operation: 'expire_session', outcome: 'applied' },
      { operation: 'void', outcome: 'applied' },
    ]);
    expect(await orderOf(order.id)).toMatchObject({ status: 'expired', paymentStatus: 'voided' });
  });

  it('voids a late checkout whose webhook came first', async () => {
    const w = world();
    const { order, attempt, ref } = await placeOrder();
    await runJobs(w.pdeps, attempt.id, ['open']);
    clock = HOLD_UNTIL;
    await runOrderTimer(deps(), { ...ref, operation: 'hold_expiry' });
    w.gateway.pay((await attemptOf(attempt.id)).sessionId as string);
    expect(await deliver(w.gateway)).toEqual(['applied', 'unchanged']);

    expect(await runJobs(w.pdeps, attempt.id)).toEqual([
      { operation: 'expire_session', outcome: 'stale' },
      { operation: 'void', outcome: 'applied' },
    ]);
    expect(await orderOf(order.id)).toMatchObject({ status: 'expired', paymentStatus: 'voided' });
  });

  it('expires an unpaid session with its Order', async () => {
    const w = world();
    const { order, attempt, ref } = await placeOrder();
    await runJobs(w.pdeps, attempt.id, ['open']);
    clock = HOLD_UNTIL;
    await runOrderTimer(deps(), { ...ref, operation: 'hold_expiry' });
    expect(await runJobs(w.pdeps, attempt.id)).toEqual([
      { operation: 'expire_session', outcome: 'unchanged' },
    ]);
    expect((await attemptOf(attempt.id)).sessionStatus).toBe('expired');
    expect(await deliver(w.gateway)).toEqual(['unchanged']);
    expect((await orderOf(order.id)).paymentStatus).toBe('none');
  });
});

describe('releases', () => {
  it('never captures after a cancel won: the capture job is stale and the void lands', async () => {
    const w = world();
    const { order, attempt, ref } = await authorized(w);
    await runJobs(w.pdeps, attempt.id, ['confirm']);
    expect((await orderOf(order.id)).status).toBe('confirmed');
    await cancel(deps(), { ...ref, trigger: 'provider_link' });

    expect(await runJobs(w.pdeps, attempt.id)).toEqual([
      { operation: 'capture', outcome: 'stale' },
      { operation: 'void', outcome: 'applied' },
    ]);
    expect(w.gateway.calls.some((c) => c.op === 'capture')).toBe(false);
    expect(await orderOf(order.id)).toMatchObject({ status: 'cancelled', paymentStatus: 'voided' });
  });

  it('refunds when the void finds the intent captured (a lost capture response)', async () => {
    const w = world();
    const { order, attempt, ref, slotId } = await authorized(w);
    await runJobs(w.pdeps, attempt.id, ['confirm']);
    w.gateway.failNext('capture', 'response-lost');
    await expect(runJobs(w.pdeps, attempt.id, ['capture'])).rejects.toMatchObject({
      code: 'unavailable',
    });
    w.gateway.takeEvents(); // the capture's webhook is late
    await cancel(deps(), { ...ref, trigger: 'provider_link' });

    const results = await runJobs(w.pdeps, attempt.id);
    expect(results).toEqual([
      { operation: 'capture', outcome: 'stale' },
      { operation: 'void', outcome: 'applied' },
      { operation: 'refund', outcome: 'applied' },
    ]);
    expect(await orderOf(order.id)).toMatchObject({
      status: 'cancelled',
      paymentStatus: 'refunded',
    });
    expect(await paymentTrail(order.id)).toEqual([
      'none>authorized',
      'authorized>captured',
      'captured>refund_pending',
      'refund_pending>refunded',
    ]);
    expect(w.gateway.state().refunds).toMatchObject([{ refundApplicationFee: true }]);
    expect(await remaining(slotId)).toBe(2);
    expect(await deliver(w.gateway)).toEqual(['unchanged']);
  });

  it("refunds a captured Order in full when the Provider can't fulfil", async () => {
    const w = world();
    const { order, attempt, ref } = await authorized(w);
    await runJobs(w.pdeps, attempt.id);
    expect((await orderOf(order.id)).paymentStatus).toBe('captured');
    await cancel(deps(), { ...ref, trigger: 'provider_link' });
    expect(await runJobs(w.pdeps, attempt.id)).toEqual([
      { operation: 'refund', outcome: 'applied' },
    ]);
    expect(await orderOf(order.id)).toMatchObject({
      status: 'cancelled',
      paymentStatus: 'refunded',
    });
    expect((await attemptOf(attempt.id)).refundStatus).toBe('succeeded');
  });

  it('flags the admin when a refund fails', async () => {
    const w = world({ refundStatus: 'failed' });
    const { order, attempt, ref } = await authorized(w);
    await runJobs(w.pdeps, attempt.id);
    await cancel(deps(), { ...ref, trigger: 'provider_link' });
    await runJobs(w.pdeps, attempt.id);
    expect((await orderOf(order.id)).paymentStatus).toBe('failed');
    expect(await notifyKinds(order.id)).toContain('admin_payment_attention');
  });

  it('records a refund Stripe says was already made as refunded', async () => {
    const w = world();
    const { order, attempt, ref } = await authorized(w);
    await runJobs(w.pdeps, attempt.id);
    await cancel(deps(), { ...ref, trigger: 'provider_link' });
    w.gateway.failNext('refund', 'charge-already-refunded');
    expect(await runJobs(w.pdeps, attempt.id)).toEqual([
      { operation: 'refund', outcome: 'applied' },
    ]);
    expect((await orderOf(order.id)).paymentStatus).toBe('refunded');
    expect(await notifyKinds(order.id)).not.toContain('admin_payment_attention');
  });
});

describe('booking a pay-online Offer in chat', () => {
  it('is bookable only for an onboarded Providerâ€™s allotment or on-request Offer', async () => {
    const pending = await onlineOffer({ card: 'pending' });
    const ctx = { spaceId: guest.spaceId, offerScope: scope() };
    await expect(
      availabilityFor(deps(), ctx, { offerId: pending.offerId, date: DAY, quantity: 1 }),
    ).rejects.toEqual(new ServiceRuleError('not-bookable-in-chat'));
    const onRequest = await onlineOffer({ availabilityMode: 'on_request' });
    expect(
      (await availabilityFor(deps(), ctx, { offerId: onRequest.offerId, date: DAY, quantity: 1 }))
        .starts,
    ).toEqual([
      { slotId: null, startsAt: null, startsAtLocal: null, remaining: null, warnings: [] },
    ]);
    const ready = await onlineOffer();
    const result = await availabilityFor(deps(), ctx, {
      offerId: ready.offerId,
      date: DAY,
      quantity: 1,
    });
    expect(result.starts).toHaveLength(1);
  });

  it('holds for the checkout window, leaves confirming to the payment job and shows payBy', async () => {
    clock = NOW;
    const w = world();
    const { offerId, slotId } = await onlineOffer();
    const ctx = { spaceId: guest.spaceId, offerScope: scope() };
    const { pendingId } = await prepareOrder(deps(), ctx, {
      offerId,
      date: DAY,
      quantity: 2,
      slotId,
    });
    const { order } = await completeOrder(deps(), {
      pendingId,
      spaceId: guest.spaceId,
      offerScope: scope(),
      contact: { email: 'guest@example.test', name: 'Ana' },
      details: { note: null, time: null },
    });
    expect(order).toMatchObject({
      status: 'confirming',
      paymentStatus: 'none',
      payBy: HOLD_UNTIL.toISOString(),
    });

    const [attempt] = await testDb.db
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.orderId, order.id));
    if (!attempt) throw new Error('no attempt');
    expect(await checkoutFor(testDb.db, guest.spaceId, order.id, clock)).toEqual({
      state: 'preparing',
    });
    await runJobs(w.pdeps, attempt.id, ['open']);
    const url = (await attemptOf(attempt.id)).checkoutUrl;
    expect(await checkoutFor(testDb.db, guest.spaceId, order.id, clock)).toEqual({
      state: 'ready',
      url,
    });
    const other = await seedGuestUnit(testDb.db, { now: NOW });
    expect(await checkoutFor(testDb.db, other.spaceId, order.id, clock)).toBeNull();

    clock = HOLD_UNTIL;
    expect(await checkoutFor(testDb.db, guest.spaceId, order.id, clock)).toEqual({
      state: 'closed',
    });
    const listed = await listSpaceOrders(testDb.db, guest.spaceId, 'de', clock);
    expect(listed.find((o) => o.id === order.id)?.payBy).toBeNull();
  });
});

describe('Provider onboarding', () => {
  it('creates one connected account, reuses it, and stores the refreshed card status', async () => {
    const { gateway } = world();
    const provider = await seedProvider(testDb.db);
    const onboarding = { db: testDb.db, gateway, now: () => clock };
    const urls = { returnUrl: 'http://admin.test/r', refreshUrl: 'http://admin.test/f' };

    const first = await providerOnboardingLink(onboarding, provider.id, urls);
    const second = await providerOnboardingLink(onboarding, provider.id, urls);
    expect(first.url).not.toBe(second.url);
    const creates = gateway.calls.filter((c) => c.op === 'create_account');
    expect(creates).toMatchObject([{ idempotencyKey: `provider:${provider.id}:account` }]);
    const [stored] = await testDb.db.select().from(providers).where(eq(providers.id, provider.id));
    expect(stored?.stripeAccountId).toBe(gateway.state().accounts[0]?.id);

    gateway.setCardStatus(stored?.stripeAccountId as string, 'active');
    expect(await refreshProviderPayments(onboarding, provider.id)).toBe('active');
    const [refreshed] = await testDb.db
      .select()
      .from(providers)
      .where(eq(providers.id, provider.id));
    expect(refreshed).toMatchObject({ stripeCardPayments: 'active', stripeCheckedAt: clock });
  });

  it('refuses a refresh before the account exists', async () => {
    const { gateway } = world();
    const provider = await seedProvider(testDb.db);
    await expect(
      refreshProviderPayments({ db: testDb.db, gateway, now: () => clock }, provider.id),
    ).rejects.toEqual(new OnboardingRuleError('no-account'));
  });
});

describe("a host's own pay-online Offer (38)", () => {
  it('is refused until the host account is active, then charged on it with no fee', async () => {
    clock = NOW;
    const w = world();
    const host = await seedGuestUnit(testDb.db, { now: NOW });
    const hostScope = {
      spaceId: host.spaceId,
      offerScope: { ...scope(), propertyId: host.propertyId },
    };
    const offer = await seedOrderableOffer(testDb.db, {
      hostId: host.hostId,
      availabilityMode: 'allotment',
      paymentMode: 'online',
      priceMinor: 2500,
      capacity: 2,
      startsAt: SLOT_AT,
      contactFields: 'name',
    });
    await publishOffer(testDb.db, offer.offerId);
    const slotId = offer.slotId as string;
    const book = { offerId: offer.offerId, date: DAY, quantity: 2, slotId };
    await expect(prepareOrder(deps(), hostScope, book)).rejects.toEqual(
      new ServiceRuleError('not-bookable-in-chat'),
    );

    const hostAccount = `acct_host_${host.hostId.slice(0, 8)}`;
    await testDb.db
      .update(accounts)
      .set({ stripeAccountId: hostAccount, stripeCardPayments: 'active' })
      .where(eq(accounts.id, host.hostId));
    const { pendingId } = await prepareOrder(deps(), hostScope, book);
    const { order } = await completeOrder(deps(), {
      pendingId,
      ...hostScope,
      contact: { email: 'guest@example.test', name: 'Ana' },
      details: { note: null, time: null },
    });
    expect((await orderOf(order.id)).commissionBp).toBe(0);
    const [attempt] = await testDb.db
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.orderId, order.id));
    if (!attempt) throw new Error('no attempt');
    expect(attempt).toMatchObject({ stripeAccountId: hostAccount, applicationFeeMinor: 0 });

    await runJobs(w.pdeps, attempt.id);
    const opened = await attemptOf(attempt.id);
    expect(w.gateway.calls.find((c) => c.op === 'create_session')).toMatchObject({
      account: hostAccount,
    });
    w.gateway.pay(opened.sessionId as string);
    await deliver(w.gateway);
    await runJobs(w.pdeps, attempt.id);
    expect(w.gateway.calls.find((c) => c.op === 'capture')).toMatchObject({
      account: hostAccount,
      params: { applicationFeeAmount: 0 },
    });
    expect(await orderOf(order.id)).toMatchObject({
      status: 'confirmed',
      paymentStatus: 'captured',
    });
  });
});

describe('host onboarding (38)', () => {
  it('creates one host account with host metadata, reuses it, and stores the card status', async () => {
    const { gateway } = world();
    const host = await seedGuestUnit(testDb.db, { now: NOW });
    const onboarding = { db: testDb.db, gateway, now: () => clock };
    const urls = { returnUrl: 'http://admin.test/r', refreshUrl: 'http://admin.test/f' };

    await hostOnboardingLink(onboarding, host.hostId, urls);
    await hostOnboardingLink(onboarding, host.hostId, urls);
    const creates = gateway.calls.filter((c) => c.op === 'create_account');
    expect(creates).toMatchObject([{ idempotencyKey: `host:${host.hostId}:account` }]);
    const [created] = gateway.state().accounts;
    expect(created?.metadata).toEqual({ fetivi_host_id: host.hostId });
    const [stored] = await testDb.db.select().from(accounts).where(eq(accounts.id, host.hostId));
    expect(stored?.stripeAccountId).toBe(created?.id);

    gateway.setCardStatus(created?.id as string, 'active');
    expect(await refreshHostPayments(onboarding, host.hostId)).toBe('active');
    const [refreshed] = await testDb.db.select().from(accounts).where(eq(accounts.id, host.hostId));
    expect(refreshed).toMatchObject({ stripeCardPayments: 'active', stripeCheckedAt: clock });
  });

  it('refuses an account that is not a host, and a refresh before the account exists', async () => {
    const { gateway } = world();
    const onboarding = { db: testDb.db, gateway, now: () => clock };
    const [admin] = await testDb.db
      .insert(accounts)
      .values({ email: `admin-${NOW.getTime()}@example.test`, passwordHash: 'x', role: 'admin' })
      .returning();
    const urls = { returnUrl: 'http://admin.test/r', refreshUrl: 'http://admin.test/f' };
    await expect(hostOnboardingLink(onboarding, admin?.id as string, urls)).rejects.toEqual(
      new OnboardingRuleError('not-found'),
    );
    const host = await seedGuestUnit(testDb.db, { now: NOW });
    await expect(refreshHostPayments(onboarding, host.hostId)).rejects.toEqual(
      new OnboardingRuleError('no-account'),
    );
  });
});

describe('disconnecting a host account', () => {
  it('waits for open card Orders, then unlinks the account and makes a new one on reconnect', async () => {
    clock = NOW;
    const w = world();
    const host = await seedGuestUnit(testDb.db, { now: NOW });
    const onboarding = { db: testDb.db, gateway: w.gateway, now: () => clock };
    const urls = { returnUrl: 'http://admin.test/r', refreshUrl: 'http://admin.test/f' };
    await hostOnboardingLink(onboarding, host.hostId, urls);
    const [linked] = await testDb.db.select().from(accounts).where(eq(accounts.id, host.hostId));
    const oldAccount = linked?.stripeAccountId as string;
    await testDb.db
      .update(accounts)
      .set({ stripeCardPayments: 'active' })
      .where(eq(accounts.id, host.hostId));

    const offer = await seedOrderableOffer(testDb.db, {
      hostId: host.hostId,
      availabilityMode: 'allotment',
      paymentMode: 'online',
      priceMinor: 2500,
      capacity: 2,
      startsAt: SLOT_AT,
      contactFields: 'name',
    });
    await publishOffer(testDb.db, offer.offerId);
    const hostScope = {
      spaceId: host.spaceId,
      offerScope: { ...scope(), propertyId: host.propertyId },
    };
    const book = { offerId: offer.offerId, date: DAY, quantity: 1, slotId: offer.slotId as string };
    const { pendingId } = await prepareOrder(deps(), hostScope, book);
    const { order } = await completeOrder(deps(), {
      pendingId,
      ...hostScope,
      contact: { email: 'guest@example.test', name: 'Ana' },
      details: { note: null, time: null },
    });

    await expect(disconnectHostPayments(onboarding, host.hostId)).rejects.toEqual(
      new OnboardingRuleError('open-card-orders'),
    );

    await testDb.db.update(orders).set({ status: 'completed' }).where(eq(orders.id, order.id));
    clock = minutes(5);
    await disconnectHostPayments(onboarding, host.hostId);
    const [after] = await testDb.db.select().from(accounts).where(eq(accounts.id, host.hostId));
    expect(after).toMatchObject({
      stripeAccountId: null,
      stripeCardPayments: null,
      stripeCheckedAt: null,
      stripeDisconnectedAt: clock,
    });
    // The earlier Order's attempt keeps the account it was paid on.
    const [attempt] = await testDb.db
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.orderId, order.id));
    expect(attempt?.stripeAccountId).toBe(oldAccount);

    await hostOnboardingLink(onboarding, host.hostId, urls);
    const creates = w.gateway.calls.filter((c) => c.op === 'create_account');
    expect(creates.at(-1)?.idempotencyKey).toBe(`host:${host.hostId}:account:${clock.getTime()}`);
    const [relinked] = await testDb.db.select().from(accounts).where(eq(accounts.id, host.hostId));
    expect(relinked?.stripeAccountId).not.toBe(oldAccount);
  });
});
