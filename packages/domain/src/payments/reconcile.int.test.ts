import { and, eq, sql } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accounts } from '../db/schema/accounts';
import { providers } from '../db/schema/offers';
import { inventoryHolds, orders, paymentAttempts } from '../db/schema/orders';
import { reconciliationFindings, reconciliationRuns } from '../db/schema/reconciliation';
import { createJobQueue, ensureQueues, type JobQueue, QUEUES } from '../jobs/queue';
import { cancel, createOrder, type OrderDeps } from '../orders/machine';
import {
  createTestDatabase,
  fakePaymentGateway,
  type SeededGuestUnit,
  seedGuestUnit,
  seedOrderableOffer,
  seedProvider,
  type TestDatabase,
} from '../testing';
import type { OrderPaymentJobData } from './enqueue';
import { applyStripeEvent, parseStripeEvent } from './events';
import { type PaymentDeps, runPaymentJob } from './jobs';
import {
  dismissFinding,
  latestRuns,
  listFindings,
  type ReconcileDeps,
  runReconciliation,
} from './reconcile';
import { CHECKOUT_HOLD_MINUTES, type PaymentOperation } from './vocabulary';

// Reconciliation against a fake Stripe (34): what a lost webhook or a lapse leaves behind is
// read back from Stripe and fed through the machine, and every disagreement is a finding. One
// fake Stripe serves the whole file, so earlier tests' attempts reconcile cleanly in later runs.

let testDb: TestDatabase;
let boss: PgBoss;
let queue: JobQueue;
let guest: SeededGuestUnit;

const NOW = new Date('2027-05-01T10:00:00Z');
const DAY = '2027-05-04';
const SLOT_AT = new Date('2027-05-04T07:00:00Z');
const HOLD_UNTIL = new Date(NOW.getTime() + CHECKOUT_HOLD_MINUTES * 60_000);
const after = (minutes: number) => new Date(HOLD_UNTIL.getTime() + minutes * 60_000);

let clock = NOW;
const deps = (): OrderDeps => ({ db: testDb.db, queue, now: () => clock });
// Refunds stay pending until a test settles them, as Stripe's sometimes do.
const gateway = fakePaymentGateway({ now: () => clock, refundStatus: 'pending' });
const pdeps = (): PaymentDeps => ({ ...deps(), gateway, guestOrigin: 'http://guest.test' });
const rdeps = (g: ReconcileDeps['gateway'] = gateway): ReconcileDeps => ({
  ...deps(),
  gateway: g,
  guestOrigin: 'http://guest.test',
});

beforeAll(async () => {
  testDb = await createTestDatabase();
  boss = new PgBoss({ connectionString: testDb.url, supervise: false, schedule: false });
  boss.on('error', console.error);
  await boss.start();
  await ensureQueues(boss);
  queue = createJobQueue(boss);
  guest = await seedGuestUnit(testDb.db, { now: NOW });
});

afterAll(async () => {
  await boss?.stop({ graceful: false, timeout: 1000 });
  await testDb?.drop();
});

async function placeOrder(paymentMode: 'online' | 'direct' = 'online') {
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
  const { order } = await createOrder(deps(), {
    spaceId: guest.spaceId,
    offerId: offer.offerId,
    slotId: offer.slotId as string,
    date: DAY,
    quantity: 2,
    contact: { email: 'guest@example.test' },
    hold: { expiresAt: HOLD_UNTIL },
  });
  const [attempt] = await testDb.db
    .select()
    .from(paymentAttempts)
    .where(eq(paymentAttempts.orderId, order.id));
  return { order, attempt, ref: { orderId: order.id, proposalId: order.currentProposalId ?? '' } };
}

async function placeOnline() {
  const placed = await placeOrder('online');
  if (!placed.attempt) throw new Error('no attempt');
  return { ...placed, attempt: placed.attempt };
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

/** Plays the pg-boss worker for one attempt's due payment jobs (only `only`, when given). */
async function runJobs(attemptId: string, only?: PaymentOperation[]) {
  const done: string[] = [];
  for (let round = 0; round < 20; round++) {
    const { rows } = await testDb.db.execute<{ id: string; data: OrderPaymentJobData }>(
      sql`select id, data from pgboss.job where name = ${QUEUES.orderPayment} and state = 'created'
          and data->>'attemptId' = ${attemptId} order by created_on, id`,
    );
    const due = rows.filter((r) => !only || only.includes(r.data.operation));
    if (due.length === 0) return done;
    for (const job of due) {
      await testDb.db.execute(sql`update pgboss.job set state = 'completed' where id = ${job.id}`);
      done.push((await runPaymentJob(pdeps(), job.data)).operation);
    }
  }
  throw new Error('payment jobs kept coming');
}

async function deliver() {
  for (const event of gateway.takeEvents()) {
    await applyStripeEvent(deps(), parseStripeEvent(event));
  }
}

/** Opens the checkout and has the guest pay; the webhooks are delivered unless `lose`. */
async function pay(attemptId: string, lose = false) {
  await runJobs(attemptId, ['open']);
  const intentId = gateway.pay((await attemptOf(attemptId)).sessionId as string);
  if (lose) gateway.takeEvents();
  else await deliver();
  return intentId;
}

const findingsOf = (runId: string) =>
  testDb.db.select().from(reconciliationFindings).where(eq(reconciliationFindings.runId, runId));

async function findingsFor(runId: string, subject: string) {
  return (await findingsOf(runId)).filter((f) => f.subject === subject);
}

describe('runReconciliation: attempts', () => {
  it('closes a lost completion webhook: the Order is authorized and confirmed next', async () => {
    const { order, attempt } = await placeOnline();
    const intentId = await pay(attempt.id, true);
    expect(await orderOf(order.id)).toMatchObject({ status: 'confirming', paymentStatus: 'none' });

    const summary = await runReconciliation(rdeps(), { trigger: 'schedule' });
    expect(summary.error).toBeNull();
    expect(await findingsFor(summary.runId, `attempt:${attempt.id}`)).toMatchObject([
      {
        kind: 'session_completed',
        status: 'resolved',
        action: 'authorize: applied',
        orderId: order.id,
        stripeRef: (await attemptOf(attempt.id)).sessionId,
        detail: `session=complete intent=${intentId}`,
      },
    ]);
    expect(await orderOf(order.id)).toMatchObject({
      status: 'confirming',
      paymentStatus: 'authorized',
    });
    expect(await runJobs(attempt.id)).toEqual(['confirm', 'capture']);
    expect(await orderOf(order.id)).toMatchObject({
      status: 'confirmed',
      paymentStatus: 'captured',
    });
    const [run] = await testDb.db
      .select()
      .from(reconciliationRuns)
      .where(eq(reconciliationRuns.id, summary.runId));
    expect(run).toMatchObject({ trigger: 'schedule', error: null });
    expect(run?.finishedAt).not.toBeNull();
    expect(run?.found).toBe(summary.found);
  });

  it('closes a lost expiry webhook: the Order expires', async () => {
    const { order, attempt } = await placeOnline();
    await runJobs(attempt.id, ['open']);
    clock = after(1);
    gateway.expireDue(clock);
    gateway.takeEvents();
    const summary = await runReconciliation(rdeps(), { trigger: 'schedule' });
    expect(await findingsFor(summary.runId, `attempt:${attempt.id}`)).toMatchObject([
      { kind: 'session_expired', status: 'resolved', action: 'session expired: applied' },
    ]);
    expect(await orderOf(order.id)).toMatchObject({ status: 'expired', paymentStatus: 'none' });
  });

  it('closes a lapse while confirming with the cancel webhook lost: the Order fails', async () => {
    const { order, attempt, ref } = await placeOnline();
    const intentId = await pay(attempt.id);
    expect(await orderOf(order.id)).toMatchObject({ paymentStatus: 'authorized' });
    gateway.lapse(intentId);
    gateway.takeEvents();
    const summary = await runReconciliation(rdeps(), { trigger: 'schedule' });
    expect(await findingsFor(summary.runId, `attempt:${attempt.id}`)).toMatchObject([
      { kind: 'intent_canceled', status: 'resolved', action: 'void: applied', stripeRef: intentId },
    ]);
    expect(await orderOf(order.id)).toMatchObject({ status: 'failed', paymentStatus: 'voided' });
    expect((await attemptOf(attempt.id)).intentStatus).toBe('canceled');
    const [hold] = await testDb.db
      .select()
      .from(inventoryHolds)
      .where(eq(inventoryHolds.proposalId, ref.proposalId));
    expect(hold?.state).toBe('released');
  });

  it('mirrors a capture whose response and webhook were lost', async () => {
    const { order, attempt } = await placeOnline();
    await pay(attempt.id);
    await runJobs(attempt.id, ['confirm']);
    gateway.failNext('capture', 'response-lost');
    await expect(runJobs(attempt.id, ['capture'])).rejects.toThrow();
    gateway.takeEvents();
    expect(await orderOf(order.id)).toMatchObject({
      status: 'confirmed',
      paymentStatus: 'authorized',
    });
    const summary = await runReconciliation(rdeps(), { trigger: 'schedule' });
    expect(await findingsFor(summary.runId, `attempt:${attempt.id}`)).toMatchObject([
      { kind: 'intent_captured', status: 'resolved', action: 'capture: applied' },
    ]);
    expect(await orderOf(order.id)).toMatchObject({ paymentStatus: 'captured' });
  });

  it('records a refund that succeeded at Stripe while Fetivi still has it pending', async () => {
    const { order, attempt, ref } = await placeOnline();
    await pay(attempt.id);
    await runJobs(attempt.id);
    await cancel(deps(), { ...ref, trigger: 'admin' });
    await runJobs(attempt.id, ['refund']);
    const { refundId } = await attemptOf(attempt.id);
    expect(await orderOf(order.id)).toMatchObject({ paymentStatus: 'refund_pending' });
    gateway.settleRefund(refundId as string, 'succeeded');
    gateway.takeEvents();
    const summary = await runReconciliation(rdeps(), { trigger: 'schedule' });
    expect(await findingsFor(summary.runId, `attempt:${attempt.id}`)).toMatchObject([
      { kind: 'refund_succeeded', status: 'resolved', stripeRef: refundId },
    ]);
    expect(await orderOf(order.id)).toMatchObject({ paymentStatus: 'refunded' });
  });

  it('records a rejected read as check_failed and carries on with the next attempt', async () => {
    const first = await placeOnline();
    await runJobs(first.attempt.id, ['open']);
    const second = await placeOnline();
    // Later `updated_at`: the first attempt is checked first.
    clock = new Date(NOW.getTime() + 60_000);
    await pay(second.attempt.id, true);
    gateway.failNext('retrieve_session', 'rejected');
    const summary = await runReconciliation(rdeps(), { trigger: 'schedule' });
    expect(await findingsFor(summary.runId, `attempt:${first.attempt.id}`)).toMatchObject([
      { kind: 'check_failed', status: 'needs_attention', detail: 'rejected (scripted)' },
    ]);
    expect(await findingsFor(summary.runId, `attempt:${second.attempt.id}`)).toMatchObject([
      { kind: 'session_completed', status: 'resolved' },
    ]);
    expect(summary.needsAttention).toBeGreaterThanOrEqual(1);
  });
});

describe('runReconciliation: orphans', () => {
  it('reports a Stripe session with no attempt behind it once, updating it on later runs', async () => {
    const { attempt } = await placeOnline();
    await runJobs(attempt.id, ['open']);
    const { sessionId } = await attemptOf(attempt.id);
    await testDb.db.delete(paymentAttempts).where(eq(paymentAttempts.id, attempt.id));
    const subject = `session:acct_test:${sessionId}`;

    const first = await runReconciliation(rdeps(), { trigger: 'schedule' });
    expect(await findingsFor(first.runId, subject)).toMatchObject([
      {
        kind: 'orphan_session',
        status: 'needs_attention',
        stripeRef: sessionId,
        detail: 'status=open intent=none',
      },
    ]);
    clock = new Date(NOW.getTime() + 5 * 60_000);
    const second = await runReconciliation(rdeps(), { trigger: 'admin' });
    const rows = await testDb.db
      .select()
      .from(reconciliationFindings)
      .where(eq(reconciliationFindings.subject, subject));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ runId: second.runId, lastSeenAt: clock, firstSeenAt: NOW });

    // The admin marks it resolved, once.
    const [admin] = await testDb.db
      .insert(accounts)
      .values({ email: 'reconcile-admin@example.test', passwordHash: 'x', role: 'admin' })
      .returning();
    if (!admin) throw new Error('no admin');
    const id = rows[0]?.id as string;
    expect(await dismissFinding(testDb.db, id, admin.id, clock)).toBe(true);
    expect(await dismissFinding(testDb.db, id, admin.id, clock)).toBe(false);
    const resolved = await listFindings(testDb.db, { status: 'resolved', limit: 500 });
    expect(resolved.find((f) => f.id === id)).toMatchObject({
      status: 'dismissed',
      resolvedBy: admin.id,
    });
    const open = await listFindings(testDb.db, { status: 'needs_attention', limit: 500 });
    expect(open.map((f) => f.id)).not.toContain(id);
    const runs = await latestRuns(testDb.db, 5);
    expect(runs.map((r) => r.startedAt.getTime())).toEqual(
      runs.map((r) => r.startedAt.getTime()).sort((x, y) => y - x),
    );
  });
});

describe('runReconciliation: holds and Stripe trouble', () => {
  it('still resolves holds when Stripe is unavailable, and records why the run stopped', async () => {
    const { order } = await placeOrder('direct');
    const live = await placeOnline();
    await runJobs(live.attempt.id, ['open']);
    clock = after(3);
    for (const op of ['retrieve_session', 'retrieve_intent', 'retrieve_refund'] as const) {
      gateway.failNext(op, 'unavailable');
    }
    const summary = await runReconciliation(rdeps(), { trigger: 'schedule' });
    expect(summary.error).toBe('stripe-unavailable');
    const [hold] = await testDb.db
      .select()
      .from(inventoryHolds)
      .where(eq(inventoryHolds.orderId, order.id));
    expect(await findingsFor(summary.runId, `hold:${hold?.id}`)).toMatchObject([
      { kind: 'hold_expired', status: 'resolved', action: 'expire: applied' },
    ]);
    expect(await orderOf(order.id)).toMatchObject({ status: 'expired' });
    expect(
      (await findingsOf(summary.runId)).filter((f) => f.kind === 'orphan_session'),
    ).toHaveLength(0);
  });

  it('runs the holds without Stripe configured', async () => {
    const { order } = await placeOrder('direct');
    clock = after(3);
    const summary = await runReconciliation(rdeps(null), { trigger: 'schedule' });
    expect(summary.error).toBe('stripe-not-configured');
    const findings = await testDb.db
      .select()
      .from(reconciliationFindings)
      .where(
        and(
          eq(reconciliationFindings.runId, summary.runId),
          eq(reconciliationFindings.orderId, order.id),
        ),
      );
    expect(findings).toMatchObject([{ kind: 'hold_expired', status: 'resolved' }]);
    expect(await orderOf(order.id)).toMatchObject({ status: 'expired' });
  });
});
