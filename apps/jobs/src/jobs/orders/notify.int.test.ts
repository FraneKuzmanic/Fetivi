import {
  confirmHeldOrder,
  createJobQueue,
  createMemoryMailer,
  createMemoryPushSender,
  createOrder,
  ensureQueues,
  getOrCreateConversation,
  type JobQueue,
  loadGuestProjection,
  loadMessages,
  type OrderDeps,
  savePushSubscription,
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
  it('emails the Provider once and delivers the guest kinds once per channel', async () => {
    const provider = await seedProvider(testDb.db);
    const { offerId, slotId } = await seedOrderableOffer(testDb.db, {
      providerId: provider.id,
      availabilityMode: 'allotment',
      startsAt: SLOT_AT,
    });
    const projection = await loadGuestProjection(testDb.db, {
      unitId: unit.unitId,
      stayId: unit.stayId,
      language: 'en',
      now: NOW,
    });
    const conversation = await getOrCreateConversation(
      testDb.db,
      unit.spaceId,
      { systemPrompt: 's', projection },
      NOW,
    );
    await savePushSubscription(
      testDb.db,
      unit.spaceId,
      { endpoint: 'https://fcm.googleapis.com/fcm/send/jobs-test', p256dh: 'p', auth: 'a' },
      NOW,
    );
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
    const push = createMemoryPushSender();
    const job = orderNotifyJob({
      db: testDb.db,
      mailer,
      push,
      guestOrigin: 'http://guest.test',
      guestLinkSecret: 'jobs-test-guest-link-secret-long-enough',
      now: () => NOW,
      providerLink: { secret: 'jobs-test-secret-that-is-long-enough-00', baseUrl: 'http://x.test' },
    });
    const ref = { orderId: order.id, proposalId };
    await job.handler({ ...ref, kind: 'provider_confirmed' });
    await job.handler({ ...ref, kind: 'provider_confirmed' });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.to).toBe(provider.email);

    // The guest's confirmation: twice in sequence, then three times at once.
    await job.handler({ ...ref, kind: 'order_confirmed' });
    await job.handler({ ...ref, kind: 'order_confirmed' });
    await Promise.all([1, 2, 3].map(() => job.handler({ ...ref, kind: 'order_confirmed' })));
    const guestMail = mailer.sent.filter((m) => m.to === 'guest@example.test');
    expect(guestMail).toHaveLength(1);
    expect(guestMail[0]?.idempotencyKey).toBe(
      `order:${order.id}:proposal:${proposalId}:notify:order_confirmed:email`,
    );
    expect(push.sent).toHaveLength(1);
    const rows = await loadMessages(testDb.db, conversation.id);
    expect(rows.filter((r) => r.kind === 'inbox')).toHaveLength(1);
    expect(rows[0]?.parts[0]).toMatchObject({
      type: 'data-inbox',
      data: { kind: 'notice', notification: 'order_confirmed', orderId: order.id },
    });
  });

  it('asks the on-request Provider and alerts the admins about a missed window, once each', async () => {
    await testDb.pool.query(
      `insert into accounts (email, password_hash, role) values ('notify-admin@example.test', 'x', 'admin')`,
    );
    const provider = await seedProvider(testDb.db);
    const { offerId } = await seedOrderableOffer(testDb.db, {
      providerId: provider.id,
      availabilityMode: 'on_request',
    });
    const { order } = await createOrder(orderDeps(), {
      spaceId: unit.spaceId,
      offerId,
      date: '2027-05-04',
      quantity: 1,
      contact: { email: 'guest@example.test', name: 'Ana' },
    });
    const ref = { orderId: order.id, proposalId: order.currentProposalId as string };
    const mailer = createMemoryMailer();
    const job = orderNotifyJob({
      db: testDb.db,
      mailer,
      push: createMemoryPushSender(),
      guestOrigin: 'http://guest.test',
      guestLinkSecret: 'jobs-test-guest-link-secret-long-enough',
      now: () => NOW,
      providerLink: { secret: 'jobs-test-secret-that-is-long-enough-00', baseUrl: 'http://x.test' },
    });
    await job.handler({ ...ref, kind: 'provider_request' });
    await job.handler({ ...ref, kind: 'provider_request' });
    await job.handler({ ...ref, kind: 'admin_window_missed' });
    await job.handler({ ...ref, kind: 'admin_window_missed' });
    expect(mailer.sent.map((m) => m.to)).toEqual([provider.email, 'notify-admin@example.test']);
    expect(mailer.sent[0]?.subject).toMatch(/^Novi upit: /);
    expect(mailer.sent[1]?.subject).toMatch(/^Provider hasn't answered: /);
  });
});
