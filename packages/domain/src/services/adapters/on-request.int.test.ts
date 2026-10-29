import { eq, sql } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { providers } from '../../db/schema/offers';
import { inventoryHolds, paymentAttempts } from '../../db/schema/orders';
import { createJobQueue, ensureQueues, type JobQueue, QUEUES } from '../../jobs/queue';
import type { GuestOfferScope } from '../../offers/guest';
import { getOrder, type OrderDeps, runOrderTimer } from '../../orders/machine';
import { authorize } from '../../orders/payments';
import { providerAccept } from '../../orders/provider-answers';
import { responseDueAt } from '../../orders/response-window';
import { orderJobId } from '../../orders/timers';
import { CHECKOUT_HOLD_MINUTES } from '../../payments/vocabulary';
import {
  createTestDatabase,
  publishOffer,
  type SeededGuestUnit,
  seedDestination,
  seedGuestUnit,
  seedOrderableOffer,
  seedProvider,
  type TestDatabase,
} from '../../testing';
import { completeOrder, prepareOrder } from '../pending/create-order';

// On request end to end (36): the guest's tap through `prepareOrder`/`completeOrder`, the
// Provider's window and its alert, and the pay-first path of a priced pay-online Offer.

let testDb: TestDatabase;
let boss: PgBoss;
let queue: JobQueue;
let guest: SeededGuestUnit;
let destinationId: string;

const NOW = new Date('2027-05-01T10:00:00Z'); // 12:00 in Zagreb
const DAY = '2027-05-04';
const DUE = new Date('2027-05-01T10:30:00Z');
const CONTACT = { email: 'guest@example.test', name: 'Ana' };

let clock = NOW;
const deps = (): OrderDeps => ({ db: testDb.db, queue, now: () => clock });
const scope = (): GuestOfferScope => ({
  destinationId,
  propertyId: guest.propertyId,
  language: 'en',
});
const ctx = () => ({ spaceId: guest.spaceId, offerScope: scope() });

beforeAll(async () => {
  testDb = await createTestDatabase();
  boss = new PgBoss({ connectionString: testDb.url, supervise: false, schedule: false });
  boss.on('error', console.error);
  await boss.start();
  await ensureQueues(boss);
  queue = createJobQueue(boss);
  guest = await seedGuestUnit(testDb.db, { now: NOW });
  destinationId = await seedDestination(testDb.db);
});

afterAll(async () => {
  await boss?.stop({ graceful: false, timeout: 1000 });
  await testDb?.drop();
});

async function onRequest(
  options: { online?: boolean; orderKind?: 'booking' | 'request'; host?: boolean } = {},
) {
  const provider = await seedProvider(testDb.db, { commissionBp: 1250 });
  if (options.online) {
    await testDb.db
      .update(providers)
      .set({ stripeAccountId: 'acct_test', stripeCardPayments: 'active' })
      .where(eq(providers.id, provider.id));
  }
  const { offerId } = await seedOrderableOffer(testDb.db, {
    ...(options.host ? { hostId: guest.hostId } : { providerId: provider.id, destinationId }),
    availabilityMode: 'on_request',
    paymentMode: options.online ? 'online' : 'direct',
    orderKind: options.orderKind,
    contactFields: 'name',
  });
  await publishOffer(testDb.db, offerId);
  return offerId;
}

async function book(offerId: string) {
  clock = NOW;
  const { pendingId } = await prepareOrder(deps(), ctx(), { offerId, date: DAY, quantity: 2 });
  const { order } = await completeOrder(deps(), {
    pendingId,
    ...ctx(),
    contact: CONTACT,
    details: { note: null, time: null },
  });
  const found = await getOrder(testDb.db, order.id);
  if (!found) throw new Error('no order');
  return found;
}

async function jobs(orderId: string, name: string) {
  const { rows } = await testDb.db.execute<{
    id: string;
    data: Record<string, string>;
    start_ms: number;
  }>(
    sql`select id, data, (extract(epoch from start_after) * 1000)::float8 as start_ms from pgboss.job where name = ${name} and data->>'orderId' = ${orderId} order by created_on, id`,
  );
  return rows;
}

const notifyKinds = async (orderId: string) =>
  (await jobs(orderId, QUEUES.orderNotify)).map((j) => j.data.kind);

const attemptsOf = (orderId: string) =>
  testDb.db.select().from(paymentAttempts).where(eq(paymentAttempts.orderId, orderId));

describe('a pay-direct on-request Order', () => {
  it('waits for the Provider with a stored deadline and a window timer at it', async () => {
    const { order, proposal } = await book(await onRequest());
    expect(order.status).toBe('pending_provider');
    expect(await notifyKinds(order.id)).toEqual(['provider_request']);
    expect(proposal.responseDueAt).toEqual(DUE);
    expect(
      responseDueAt(NOW, { windowMinutes: 30, from: '08:00', to: '21:00' }, 'Europe/Zagreb'),
    ).toEqual(DUE);
    const timers = await jobs(order.id, QUEUES.orderTimer);
    expect(timers.map((t) => [t.id, t.start_ms])).toEqual([
      [orderJobId(order.id, proposal.id, 'response_window'), DUE.getTime()],
    ]);
    // No capacity to hold: nothing was held.
    const holds = await testDb.db
      .select()
      .from(inventoryHolds)
      .where(eq(inventoryHolds.orderId, order.id));
    expect(holds).toEqual([]);
  });

  it('alerts the admin once when the window is missed, and not after an answer', async () => {
    const { order, proposal } = await book(await onRequest());
    const timer = {
      orderId: order.id,
      proposalId: proposal.id,
      operation: 'response_window' as const,
    };
    expect((await runOrderTimer(deps(), timer)).outcome).toBe('stale');
    clock = DUE;
    expect((await runOrderTimer(deps(), timer)).outcome).toBe('applied');
    expect((await runOrderTimer(deps(), timer)).outcome).toBe('applied');
    expect(await notifyKinds(order.id)).toEqual(['provider_request', 'admin_window_missed']);

    const answered = await book(await onRequest());
    await providerAccept(
      deps(),
      { orderId: answered.order.id, proposalId: answered.proposal.id },
      {
        trigger: 'provider_link',
      },
    );
    clock = DUE;
    expect(
      (
        await runOrderTimer(deps(), {
          orderId: answered.order.id,
          proposalId: answered.proposal.id,
          operation: 'response_window',
        })
      ).outcome,
    ).toBe('stale');
    expect(await notifyKinds(answered.order.id)).not.toContain('admin_window_missed');
    clock = NOW;
  });

  it("takes a host's own on-request Offer to the host, with no commission (38)", async () => {
    const { order } = await book(await onRequest({ host: true }));
    expect(order).toMatchObject({ status: 'pending_provider', commissionBp: 0 });
    expect(await notifyKinds(order.id)).toEqual(['provider_request']);
  });
});

describe('a pay-online on-request Order', () => {
  it('is paid first, then put to the Provider, then captured on Accept', async () => {
    const { order, proposal } = await book(await onRequest({ online: true }));
    expect(order.status).toBe('confirming');
    const [attempt] = await attemptsOf(order.id);
    expect(attempt).toMatchObject({ proposalVersion: 1, amountMinor: 5000 });
    expect(await notifyKinds(order.id)).toEqual([]);

    const paid = await authorize(deps(), {
      attemptId: attempt?.id ?? '',
      paymentIntentId: 'pi_e2e',
      trigger: 'payment_webhook',
    });
    expect(paid.order).toMatchObject({ status: 'pending_provider', paymentStatus: 'authorized' });
    const [hold] = await testDb.db
      .select()
      .from(inventoryHolds)
      .where(eq(inventoryHolds.proposalId, proposal.id));
    expect(hold?.state).toBe('released');
    expect(await notifyKinds(order.id)).toEqual(['provider_request']);

    const accepted = await providerAccept(
      deps(),
      { orderId: order.id, proposalId: proposal.id },
      { trigger: 'provider_link' },
    );
    expect(accepted.order.status).toBe('confirmed');
    const { rows } = await testDb.db.execute<{ operation: string }>(
      sql`select data->>'operation' as operation from pgboss.job where name = ${QUEUES.orderPayment} and data->>'attemptId' = ${attempt?.id ?? ''} order by created_on, id`,
    );
    expect(rows.map((r) => r.operation)).toEqual(['open', 'capture']);
  });

  it('expires an unpaid checkout without ever asking the Provider', async () => {
    const { order, proposal } = await book(await onRequest({ online: true }));
    clock = new Date(NOW.getTime() + CHECKOUT_HOLD_MINUTES * 60_000);
    const expired = await runOrderTimer(deps(), {
      orderId: order.id,
      proposalId: proposal.id,
      operation: 'hold_expiry',
    });
    expect(expired.order.status).toBe('expired');
    expect(await notifyKinds(order.id)).toEqual(['order_checkout_expired']);
    clock = NOW;
  });

  it('asks the Provider for a price first when the Offer has none', async () => {
    const { order, proposal } = await book(await onRequest({ online: true, orderKind: 'request' }));
    expect(order.status).toBe('pending_provider');
    expect(proposal.priceMinor).toBeNull();
    expect(await attemptsOf(order.id)).toEqual([]);
  });
});
