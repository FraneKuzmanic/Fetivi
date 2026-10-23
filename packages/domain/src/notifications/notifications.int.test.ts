import { eq } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accounts } from '../db/schema/accounts';
import { orderNotificationDeliveries } from '../db/schema/notifications';
import { providers } from '../db/schema/offers';
import { orderEvents, orderProposals, orders } from '../db/schema/orders';
import { createJobQueue, ensureQueues, type JobQueue } from '../jobs/queue';
import { createMemoryMailer, type Mailer } from '../mail';
import { cancel, confirm, createOrder, type OrderDeps } from '../orders/machine';
import { confirmHeldOrder } from '../services/adapters';
import { createTestDatabase, type TestDatabase } from '../testing';
import {
  type SeededGuestUnit,
  seedGuestUnit,
  seedOrderableOffer,
  seedProvider,
} from '../testing/fixtures';
import { hashToken } from '../tokens';
import { sendAdminAlert } from './admin';
import { type NotifyDeps, sendProviderNotification } from './provider/send';

let testDb: TestDatabase;
let boss: PgBoss;
let queue: JobQueue;
let unit: SeededGuestUnit;

const NOW = new Date('2027-05-01T10:00:00Z');
const DAY = '2027-05-04';
const SLOT_AT = new Date('2027-05-04T07:00:00Z');
const HOLD_UNTIL = new Date('2027-05-01T10:30:00Z');
const BASE_URL = 'https://host.fetivi.test';

const orderDeps = (): OrderDeps => ({ db: testDb.db, queue, now: () => NOW });
const notifyDeps = (mailer: Mailer): NotifyDeps => ({
  db: testDb.db,
  mailer,
  now: () => NOW,
  providerLink: { secret: 'notify-test-secret-that-is-long-enough-0', baseUrl: BASE_URL },
});

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

/** A confirmed allotment Order; Provider-owned unless `host` is set. */
async function confirmedOrder(options: { language?: 'hr' | 'en'; host?: boolean } = {}) {
  const provider = await seedProvider(testDb.db, { language: options.language });
  const { offerId, slotId } = await seedOrderableOffer(testDb.db, {
    ...(options.host ? { hostId: unit.hostId } : { providerId: provider.id }),
    availabilityMode: 'allotment',
    capacity: 4,
    startsAt: SLOT_AT,
    contactFields: 'name',
  });
  if (!slotId) throw new Error('no slot');
  const { order } = await createOrder(orderDeps(), {
    spaceId: unit.spaceId,
    offerId,
    slotId,
    date: DAY,
    quantity: 2,
    contact: { email: 'ana@example.test', name: 'Ana Horvat', phone: '+385 91 000 0000' },
    hold: { expiresAt: HOLD_UNTIL },
  });
  const ref = { orderId: order.id, proposalId: order.currentProposalId as string };
  await confirmHeldOrder(orderDeps(), ref);
  return { job: { ...ref, kind: 'provider_confirmed' as const }, provider };
}

describe('the Provider email', () => {
  it('carries the Order, the configured guest field and the link, once', async () => {
    const { job, provider } = await confirmedOrder();
    const mailer = createMemoryMailer();
    expect(await sendProviderNotification(notifyDeps(mailer), job)).toBe('sent');
    expect(mailer.sent).toHaveLength(1);
    const [mail] = mailer.sent;
    expect(mail?.to).toBe(provider.email);
    expect(mail?.subject).toBe('Nova narudžba: Kayak tour, 4.5.2027.');
    expect(mail?.text).toContain('Ana Horvat');
    expect(mail?.text).toContain('Vrijeme: 09:00');
    expect(mail?.text).not.toContain('+385 91 000 0000');
    expect(mail?.text).not.toContain('ana@example.test');
    expect(mail?.idempotencyKey).toBe(
      `order:${job.orderId}:proposal:${job.proposalId}:notify:provider_confirmed`,
    );
    const token = mail?.text.match(/\/api\/provider-link\/([A-Za-z0-9_-]{43})/)?.[1];
    const [order] = await testDb.db.select().from(orders).where(eq(orders.id, job.orderId));
    expect(token && hashToken(token)).toBe(order?.providerLinkTokenHash);

    expect(await sendProviderNotification(notifyDeps(mailer), job)).toBe('already_sent');
    expect(mailer.sent).toHaveLength(1);
  });

  it("is written in the Provider's language", async () => {
    const { job } = await confirmedOrder({ language: 'en' });
    const mailer = createMemoryMailer();
    await sendProviderNotification(notifyDeps(mailer), job);
    expect(mailer.sent[0]?.subject).toBe('New order: Kayak tour, 4 May 2027');
  });

  it('leaves no delivery when the send fails, so a retry sends', async () => {
    const { job } = await confirmedOrder();
    const failing: Mailer = {
      send: async () => {
        throw new Error('transport down');
      },
    };
    await expect(sendProviderNotification(notifyDeps(failing), job)).rejects.toThrow(
      'transport down',
    );
    const rows = await testDb.db
      .select()
      .from(orderNotificationDeliveries)
      .where(eq(orderNotificationDeliveries.orderId, job.orderId));
    expect(rows).toHaveLength(0);
    const mailer = createMemoryMailer();
    expect(await sendProviderNotification(notifyDeps(mailer), job)).toBe('sent');
    expect(mailer.sent).toHaveLength(1);
  });

  it("is skipped for a host's own Offer", async () => {
    const { job } = await confirmedOrder({ host: true });
    const mailer = createMemoryMailer();
    expect(await sendProviderNotification(notifyDeps(mailer), job)).toBe('skipped');
    expect(mailer.sent).toHaveLength(0);
    const [order] = await testDb.db.select().from(orders).where(eq(orders.id, job.orderId));
    expect(order?.providerLinkTokenHash).toBeNull();
  });

  it('is skipped, with no link issued, once the Order is no longer confirmed', async () => {
    const { job } = await confirmedOrder();
    await cancel(orderDeps(), {
      orderId: job.orderId,
      proposalId: job.proposalId,
      trigger: 'guest',
    });
    const mailer = createMemoryMailer();
    expect(await sendProviderNotification(notifyDeps(mailer), job)).toBe('skipped');
    expect(mailer.sent).toHaveLength(0);
    const [order] = await testDb.db.select().from(orders).where(eq(orders.id, job.orderId));
    expect(order?.providerLinkTokenHash).toBeNull();
  });
});

describe('the admin alert', () => {
  it('is skipped while there is no admin', async () => {
    const { job } = await confirmedOrder();
    const mailer = createMemoryMailer();
    const alert = { ...job, kind: 'admin_provider_cancelled' as const };
    expect(await sendAdminAlert(notifyDeps(mailer), alert)).toBe('skipped');
  });

  it('reaches every admin once, without guest details', async () => {
    await testDb.db.insert(accounts).values([
      { email: 'admin-a@example.test', passwordHash: 'x', role: 'admin' },
      { email: 'admin-b@example.test', passwordHash: 'x', role: 'admin' },
    ]);
    const { job } = await confirmedOrder();
    const mailer = createMemoryMailer();
    const alert = { ...job, kind: 'admin_provider_cancelled' as const };
    expect(await sendAdminAlert(notifyDeps(mailer), alert)).toBe('sent');
    expect(mailer.sent.map((m) => m.to)).toEqual(['admin-a@example.test', 'admin-b@example.test']);
    expect(mailer.sent[0]?.text).toContain(job.orderId);
    expect(mailer.sent[0]?.text).not.toContain('Ana Horvat');
    expect(mailer.sent[0]?.text).not.toContain('Open it:');
    expect(await sendAdminAlert(notifyDeps(mailer), alert)).toBe('already_sent');
    expect(mailer.sent).toHaveLength(2);
  });

  it('links the admin Order page when the back-office origin is known', async () => {
    const { job } = await confirmedOrder();
    const mailer = createMemoryMailer();
    const deps = { ...notifyDeps(mailer), webOrigin: 'https://host.example.test' };
    const alert = { ...job, kind: 'admin_provider_cancelled' as const };
    expect(await sendAdminAlert(deps, alert)).toBe('sent');
    expect(mailer.sent[0]?.text).toContain(
      `Open it: https://host.example.test/admin/orders/${job.orderId}`,
    );
  });

  it('tells the admins why a payment needs a look, from the flagging event, once per flag', async () => {
    const { job } = await confirmedOrder();
    const EVENT = {
      orderId: job.orderId,
      trigger: 'payment_job',
      fromStatus: 'confirmed',
      toStatus: 'confirmed',
      toPaymentStatus: 'none',
      createdAt: NOW,
    } as const;
    const [first, later] = await testDb.db
      .insert(orderEvents)
      .values([
        { ...EVENT, note: 'capture failed (card_declined)' },
        { ...EVENT, note: 'authorization cancelled on a confirmed Order' },
      ])
      .returning({ id: orderEvents.id });
    // A later note (an admin's, say) never stands in for the reason.
    await testDb.db.insert(orderEvents).values({ ...EVENT, trigger: 'admin', note: 'called' });
    const mailer = createMemoryMailer();
    const alert = { ...job, kind: 'admin_payment_attention' as const };
    expect(await sendAdminAlert(notifyDeps(mailer), { ...alert, eventId: first?.id })).toBe('sent');
    expect(mailer.sent[0]?.subject).toMatch(/^Payment needs a look: /);
    expect(mailer.sent[0]?.text).toContain(
      `Order ${job.orderId} (Kayak tour, 4 May 2027) needs a look: capture failed (card_declined).`,
    );
    expect(mailer.sent[0]?.text).not.toContain('ana@example.test');
    expect(await sendAdminAlert(notifyDeps(mailer), { ...alert, eventId: first?.id })).toBe(
      'already_sent',
    );
    // A second problem on the same proposal is its own alert.
    expect(await sendAdminAlert(notifyDeps(mailer), { ...alert, eventId: later?.id })).toBe('sent');
    expect(mailer.sent.at(-1)?.text).toContain(
      'needs a look: authorization cancelled on a confirmed Order.',
    );
  });
});

/** A pay-direct on-request Order waiting for the Provider (36). */
async function pendingOrder() {
  const provider = await seedProvider(testDb.db, { language: 'en' });
  await testDb.db
    .update(providers)
    .set({ whatsappPhone: '+385 98 111 2222' })
    .where(eq(providers.id, provider.id));
  const { offerId } = await seedOrderableOffer(testDb.db, {
    providerId: provider.id,
    availabilityMode: 'on_request',
    contactFields: 'name',
  });
  const { order } = await createOrder(orderDeps(), {
    spaceId: unit.spaceId,
    offerId,
    date: DAY,
    quantity: 2,
    contact: { email: 'ana@example.test', name: 'Ana Horvat' },
  });
  const ref = { orderId: order.id, proposalId: order.currentProposalId as string };
  return { ref, provider };
}

describe('the on-request ask', () => {
  it('asks the Provider to answer by the due time, with the link', async () => {
    const { ref, provider } = await pendingOrder();
    const job = { ...ref, kind: 'provider_request' as const };
    const mailer = createMemoryMailer();
    expect(await sendProviderNotification(notifyDeps(mailer), job)).toBe('sent');
    const [mail] = mailer.sent;
    expect(mail?.to).toBe(provider.email);
    expect(mail?.subject).toBe('New request: Kayak tour, 4 May 2027');
    expect(mail?.text).toContain('Please answer by 1 May 2027 12:30.');
    expect(mail?.text).toMatch(/\/api\/provider-link\/[A-Za-z0-9_-]{43}/);
    expect(mail?.idempotencyKey).toBe(
      `order:${ref.orderId}:proposal:${ref.proposalId}:notify:provider_request`,
    );
  });

  it('is skipped once the Provider has answered', async () => {
    const { ref } = await pendingOrder();
    await confirm(orderDeps(), { ...ref, trigger: 'provider_link' });
    const mailer = createMemoryMailer();
    const job = { ...ref, kind: 'provider_request' as const };
    expect(await sendProviderNotification(notifyDeps(mailer), job)).toBe('skipped');
  });

  it('never falls back to the confirmed email when the deadline is missing', async () => {
    const { ref } = await pendingOrder();
    await testDb.db
      .update(orderProposals)
      .set({ responseDueAt: null })
      .where(eq(orderProposals.id, ref.proposalId));
    const mailer = createMemoryMailer();
    const job = { ...ref, kind: 'provider_request' as const };
    await expect(sendProviderNotification(notifyDeps(mailer), job)).rejects.toThrow(
      /no response deadline/,
    );
    expect(mailer.sent).toHaveLength(0);
  });
});

describe('the missed-window alert', () => {
  it("gives the admins the Provider's contact details, not the guest's", async () => {
    await testDb.db
      .insert(accounts)
      .values({ email: 'admin-window@example.test', passwordHash: 'x', role: 'admin' })
      .onConflictDoNothing();
    const { ref, provider } = await pendingOrder();
    const mailer = createMemoryMailer();
    const alert = { ...ref, kind: 'admin_window_missed' as const };
    expect(await sendAdminAlert(notifyDeps(mailer), alert)).toBe('sent');
    const [mail] = mailer.sent;
    expect(mail?.subject).toBe("Provider hasn't answered: Kayak tour, 4 May 2027");
    expect(mail?.text).toContain('The answer was due 1 May 2027 12:30.');
    expect(mail?.text).toContain(`Provider email: ${provider.email}`);
    expect(mail?.text).toContain('Provider phone: +385 98 111 2222');
    expect(mail?.text).not.toContain('Ana Horvat');
    expect(mail?.text).not.toContain('ana@example.test');
  });

  it('is skipped once the Order is no longer waiting', async () => {
    const { ref } = await pendingOrder();
    await confirm(orderDeps(), { ...ref, trigger: 'admin' });
    const mailer = createMemoryMailer();
    const alert = { ...ref, kind: 'admin_window_missed' as const };
    expect(await sendAdminAlert(notifyDeps(mailer), alert)).toBe('skipped');
    expect(mailer.sent).toHaveLength(0);
  });
});
