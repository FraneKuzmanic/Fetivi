import {
  CHECKOUT_HOLD_MINUTES,
  createJobQueue,
  createOrder,
  ensureQueues,
  type JobQueue,
  type OrderDeps,
  QUEUES,
  RECONCILE_CRON,
  runPaymentJob,
} from '@fetivi/domain';
import {
  createTestDatabase,
  fakePaymentGateway,
  type SeededGuestUnit,
  seedGuestUnit,
  seedOrderableOffer,
  seedProvider,
  type TestDatabase,
} from '@fetivi/domain/testing';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createJobs } from './index';
import { reconcileJob } from './reconcile';

let testDb: TestDatabase;
let boss: PgBoss;
let queue: JobQueue;
let unit: SeededGuestUnit;

const NOW = new Date('2027-05-01T10:00:00Z');
const SLOT_AT = new Date('2027-05-04T07:00:00Z');
const HOLD_UNTIL = new Date(NOW.getTime() + CHECKOUT_HOLD_MINUTES * 60_000);

let clock = NOW;
const orderDeps = (): OrderDeps => ({ db: testDb.db, queue, now: () => clock });
const gateway = fakePaymentGateway({ now: () => clock });

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

async function placeOrder(paymentMode: 'online' | 'direct') {
  clock = NOW;
  const provider = await seedProvider(testDb.db, { commissionBp: 1250 });
  await testDb.pool.query(
    `update providers set stripe_account_id = 'acct_jobs', stripe_card_payments = 'active' where id = $1`,
    [provider.id],
  );
  const { offerId, slotId } = await seedOrderableOffer(testDb.db, {
    providerId: provider.id,
    availabilityMode: 'allotment',
    paymentMode,
    priceMinor: 2500,
    startsAt: SLOT_AT,
  });
  const { order } = await createOrder(orderDeps(), {
    spaceId: unit.spaceId,
    offerId,
    slotId,
    date: '2027-05-04',
    quantity: 1,
    contact: { email: 'guest@example.test' },
    hold: { expiresAt: HOLD_UNTIL },
  });
  return order;
}

async function orderOf(id: string) {
  const order = await testDb.db.query.orders.findFirst({ where: (t, { eq }) => eq(t.id, id) });
  if (!order) throw new Error('no order');
  return order;
}

const runOf = (id: string) =>
  testDb.db.query.reconciliationRuns.findFirst({ where: (t, { eq }) => eq(t.id, id) });

async function lastRun() {
  const run = await testDb.db.query.reconciliationRuns.findFirst({
    orderBy: (t, { desc }) => desc(t.startedAt),
  });
  if (!run) throw new Error('no run');
  return run;
}

describe('reconcile job', () => {
  it('is scheduled every 5 minutes', () => {
    const jobs = createJobs({} as Parameters<typeof createJobs>[0]);
    expect(jobs.find((j) => j.name === QUEUES.reconcile)?.cron).toBe(RECONCILE_CRON);
  });

  it('closes a lost completion webhook on an admin run', async () => {
    const order = await placeOrder('online');
    const attempt = await testDb.db.query.paymentAttempts.findFirst({
      where: (t, { eq }) => eq(t.orderId, order.id),
    });
    if (!attempt) throw new Error('no attempt');
    const deps = { ...orderDeps(), gateway, guestOrigin: 'http://guest.test' };
    await runPaymentJob(deps, { attemptId: attempt.id, operation: 'open' });
    const opened = await testDb.db.query.paymentAttempts.findFirst({
      where: (t, { eq }) => eq(t.id, attempt.id),
    });
    gateway.pay(opened?.sessionId as string);
    gateway.takeEvents();

    const admin = await testDb.pool.query<{ id: string }>(
      `insert into accounts (email, password_hash, role) values ('reconcile-admin@example.test', 'x', 'admin') returning id`,
    );
    const requestedBy = admin.rows[0]?.id;
    await reconcileJob(deps).handler({ trigger: 'admin', requestedBy });

    expect(await orderOf(order.id)).toMatchObject({
      status: 'confirming',
      paymentStatus: 'authorized',
    });
    expect(await lastRun()).toMatchObject({ trigger: 'admin', requestedBy, error: null });
  });

  it('reconciles holds without Stripe and records why Stripe was skipped', async () => {
    const order = await placeOrder('direct');
    clock = new Date(HOLD_UNTIL.getTime() + 5 * 60_000);
    await reconcileJob({ ...orderDeps(), gateway: null, guestOrigin: 'http://guest.test' }).handler(
      {},
    );
    expect((await orderOf(order.id)).status).toBe('expired');
    const run = await lastRun();
    expect(run).toMatchObject({ trigger: 'schedule', error: 'stripe-not-configured' });
    expect((await runOf(run.id))?.finishedAt).not.toBeNull();
  });
});
