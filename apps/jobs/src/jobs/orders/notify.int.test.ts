import {
  confirmHeldOrder,
  createJobQueue,
  createMemoryMailer,
  createOrder,
  ensureQueues,
  type JobQueue,
  type OrderDeps,
} from '@fetivi/domain';
import {
  createTestDatabase,
  type SeededGuestUnit,
  seedGuestUnit,
  seedOrderableOffer,
  seedProvider,
  type TestDatabase,
} from '@fetivi/domain/testing';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { orderNotifyJob } from './notify';

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

describe('order-notify job', () => {
  it('emails the Provider once and only logs the guest kinds', async () => {
    const provider = await seedProvider(testDb.db);
    const { offerId, slotId } = await seedOrderableOffer(testDb.db, {
      providerId: provider.id,
      availabilityMode: 'allotment',
      startsAt: SLOT_AT,
    });
    const { order } = await createOrder(orderDeps(), {
      spaceId: unit.spaceId,
      offerId,
      slotId,
      date: '2027-05-04',
      quantity: 1,
      contact: { email: 'guest@example.test', name: 'Ana' },
      hold: { expiresAt: new Date('2027-05-01T10:30:00Z') },
    });
    const proposalId = order.currentProposalId as string;
    await confirmHeldOrder(orderDeps(), { orderId: order.id, proposalId });

    const mailer = createMemoryMailer();
    const job = orderNotifyJob({
      db: testDb.db,
      mailer,
      now: () => NOW,
      providerLink: { secret: 'jobs-test-secret-that-is-long-enough-00', baseUrl: 'http://x.test' },
    });
    const ref = { orderId: order.id, proposalId };
    await job.handler({ ...ref, kind: 'provider_confirmed' });
    await job.handler({ ...ref, kind: 'provider_confirmed' });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.to).toBe(provider.email);
    await job.handler({ ...ref, kind: 'order_confirmed' });
    expect(mailer.sent).toHaveLength(1);
  });
});
