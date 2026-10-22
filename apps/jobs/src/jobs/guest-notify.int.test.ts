import {
  confirmHeldOrder,
  createJobQueue,
  createMemoryMailer,
  createMemoryPushSender,
  createOrder,
  ensureQueues,
  type GuestNotifyDeps,
  type JobQueue,
  QUEUES,
} from '@fetivi/domain';
import {
  createTestDatabase,
  seedGuestUnit,
  seedOrderableOffer,
  type TestDatabase,
} from '@fetivi/domain/testing';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { guestNotifyJob, guestRemindersJob } from './guest-notify';

let testDb: TestDatabase;
let boss: PgBoss;
let queue: JobQueue;

const NOW = new Date('2027-05-01T10:00:00Z');

beforeAll(async () => {
  testDb = await createTestDatabase();
  boss = new PgBoss({ connectionString: testDb.url, supervise: false, schedule: false });
  boss.on('error', console.error);
  await boss.start();
  await ensureQueues(boss);
  queue = createJobQueue(boss);
});

afterAll(async () => {
  await boss?.stop({ graceful: false, timeout: 1000 });
  await testDb?.drop();
});

const guestJobs = async (spaceId: string) => {
  const { rows } = await testDb.pool.query<{ data: Record<string, string> }>(
    "select data from pgboss.job where name = $1 and data->>'spaceId' = $2 order by created_on",
    [QUEUES.guestNotify, spaceId],
  );
  return rows.map((r) => r.data);
};

function notifyDeps(
  now: Date,
): GuestNotifyDeps & { mailer: ReturnType<typeof createMemoryMailer> } {
  return {
    db: testDb.db,
    mailer: createMemoryMailer(),
    push: createMemoryPushSender(),
    guestOrigin: 'http://guest.test',
    now: () => now,
  };
}

describe('guest-reminders job', () => {
  it('enqueues the arrival notice once across repeated and later runs', async () => {
    // Check-in 3 May: released 2 May 00:00 Zagreb = 1 May 22:00Z.
    const g = await seedGuestUnit(testDb.db, { now: NOW, checkInInDays: 2 });
    const run = (iso: string) =>
      guestRemindersJob({ db: testDb.db, queue, now: () => new Date(iso) }).handler({});
    await run('2027-05-01T21:45:00Z');
    expect(await guestJobs(g.spaceId)).toEqual([]);
    await run('2027-05-01T22:00:00Z');
    await run('2027-05-01T22:00:00Z');
    await run('2027-05-01T22:15:00Z');
    expect(await guestJobs(g.spaceId)).toEqual([{ kind: 'arrival_details', spaceId: g.spaceId }]);
  });

  it('enqueues nothing for a closed space', async () => {
    const g = await seedGuestUnit(testDb.db, { now: NOW, checkInInDays: 2 });
    await testDb.pool.query('update spaces set closed_at = $1 where id = $2', [NOW, g.spaceId]);
    await guestRemindersJob({
      db: testDb.db,
      queue,
      now: () => new Date('2027-05-01T22:15:00Z'),
    }).handler({});
    expect(await guestJobs(g.spaceId)).toEqual([]);
  });
});

describe('guest-notify job', () => {
  it('sends the Order reminder, and nothing once the Order is cancelled', async () => {
    const g = await seedGuestUnit(testDb.db, { now: NOW });
    const { offerId, slotId } = await seedOrderableOffer(testDb.db, {
      hostId: g.hostId,
      availabilityMode: 'allotment',
      startsAt: new Date('2027-05-04T07:00:00Z'),
    });
    const orderDeps = { db: testDb.db, queue, now: () => NOW };
    const { order } = await createOrder(orderDeps, {
      spaceId: g.spaceId,
      offerId,
      slotId,
      date: '2027-05-04',
      quantity: 1,
      contact: { email: 'guest@example.test', name: 'Ana' },
      hold: { expiresAt: new Date('2027-05-01T10:30:00Z') },
    });
    const proposalId = order.currentProposalId as string;
    await confirmHeldOrder(orderDeps, { orderId: order.id, proposalId });
    const [reminder] = await guestJobs(g.spaceId);
    expect(reminder).toEqual({
      kind: 'order_reminder',
      spaceId: g.spaceId,
      orderId: order.id,
      proposalId,
    });
    const data = {
      kind: 'order_reminder' as const,
      spaceId: g.spaceId,
      orderId: order.id,
      proposalId,
    };
    const evening = new Date('2027-05-03T16:00:00Z');

    const sent = notifyDeps(evening);
    await guestNotifyJob(sent).handler(data);
    await guestNotifyJob(sent).handler(data);
    expect(sent.mailer.sent.map((m) => m.to)).toEqual(['guest@example.test']);

    // A second Order on the same space, cancelled before its evening: nothing goes out.
    const { order: other } = await createOrder(orderDeps, {
      spaceId: g.spaceId,
      offerId,
      slotId,
      date: '2027-05-04',
      quantity: 1,
      contact: { email: 'other@example.test', name: 'Ana' },
      hold: { expiresAt: new Date('2027-05-01T10:30:00Z') },
    });
    const otherProposal = other.currentProposalId as string;
    await confirmHeldOrder(orderDeps, { orderId: other.id, proposalId: otherProposal });
    await testDb.pool.query("update orders set status = 'cancelled' where id = $1", [other.id]);
    const skipped = notifyDeps(evening);
    await guestNotifyJob(skipped).handler({
      kind: 'order_reminder',
      spaceId: g.spaceId,
      orderId: other.id,
      proposalId: otherProposal,
    });
    expect(skipped.mailer.sent).toEqual([]);
  });
});
