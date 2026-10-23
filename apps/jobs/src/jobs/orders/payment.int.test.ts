import {
  createJobQueue,
  createOrder,
  ensureQueues,
  type JobQueue,
  type OrderDeps,
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
import { orderPaymentJob } from './payment';

let testDb: TestDatabase;
let boss: PgBoss;
let queue: JobQueue;
let unit: SeededGuestUnit;

const NOW = new Date('2027-05-01T10:00:00Z');
const SLOT_AT = new Date('2027-05-04T07:00:00Z');

const orderDeps = (): OrderDeps => ({ db: testDb.db, queue, now: () => NOW });

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

async function placeOnlineOrder() {
  const provider = await seedProvider(testDb.db, { commissionBp: 1250 });
  await testDb.pool.query(
    `update providers set stripe_account_id = 'acct_jobs', stripe_card_payments = 'active' where id = $1`,
    [provider.id],
  );
  const { offerId, slotId } = await seedOrderableOffer(testDb.db, {
    providerId: provider.id,
    availabilityMode: 'allotment',
    paymentMode: 'online',
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
    hold: { expiresAt: new Date(NOW.getTime() + 30 * 60_000) },
  });
  const attempt = await testDb.db.query.paymentAttempts.findFirst({
    where: (t, { eq }) => eq(t.orderId, order.id),
  });
  if (!attempt) throw new Error('no attempt');
  return attempt;
}

describe('order-payment job', () => {
  it('opens the Checkout Session and stores its URL', async () => {
    const attempt = await placeOnlineOrder();
    const gateway = fakePaymentGateway({ now: () => NOW });
    const job = orderPaymentJob({ ...orderDeps(), gateway, guestOrigin: 'http://guest.test' });
    await job.handler({ attemptId: attempt.id, operation: 'open' });
    const after = await testDb.db.query.paymentAttempts.findFirst({
      where: (t, { eq }) => eq(t.id, attempt.id),
    });
    expect(after?.checkoutUrl).toMatch(/^https:\/\//);
    expect(after?.sessionStatus).toBe('open');
    expect(gateway.calls.filter((c) => c.op === 'create_session')).toHaveLength(1);
  });

  it('fails visibly without a gateway', async () => {
    const attempt = await placeOnlineOrder();
    const job = orderPaymentJob({
      ...orderDeps(),
      gateway: null,
      guestOrigin: 'http://guest.test',
    });
    await expect(job.handler({ attemptId: attempt.id, operation: 'open' })).rejects.toThrow(
      'stripe-not-configured',
    );
  });
});
