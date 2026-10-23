import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { allotmentSlots } from '../../db/schema/offers';
import { orderProposals, orders } from '../../db/schema/orders';
import { createJobQueue, ensureQueues, type JobQueue, QUEUES } from '../../jobs/queue';
import {
  cancel,
  confirm,
  createOrder,
  getOrder,
  guestConfirm,
  type OrderDeps,
  propose,
} from '../../orders/machine';
import { createTestDatabase, type TestDatabase } from '../../testing';
import {
  type SeededGuestUnit,
  seedGuestUnit,
  seedOrderableOffer,
  seedProvider,
} from '../../testing/fixtures';
import { hashToken } from '../../tokens';
import { confirmHeldOrder } from '../adapters';
import {
  acceptOrder,
  acknowledgeOrder,
  cannotFulfil,
  declineOrder,
  findOrderByLinkToken,
  issueProviderLink,
  proposeOrder,
  providerLinkView,
} from './link';
import { providerLinkToken } from './token';

let testDb: TestDatabase;
let boss: PgBoss;
let queue: JobQueue;
let unit: SeededGuestUnit;

const SECRET = 'link-test-secret-that-is-long-enough-000';
const NOW = new Date('2027-05-01T10:00:00Z');
const DAY = '2027-05-04';
const SLOT_AT = new Date('2027-05-04T07:00:00Z'); // 09:00 in Zagreb
const HOLD_UNTIL = new Date('2027-05-01T10:30:00Z');

const deps = (): OrderDeps => ({ db: testDb.db, queue, now: () => NOW });

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

/** A confirmed allotment Order on a Provider Offer that shares only the guest's name. */
async function confirmedOrder() {
  const provider = await seedProvider(testDb.db);
  const { offerId, slotId } = await seedOrderableOffer(testDb.db, {
    providerId: provider.id,
    availabilityMode: 'allotment',
    capacity: 4,
    startsAt: SLOT_AT,
    contactFields: 'name',
  });
  if (!slotId) throw new Error('no slot');
  const { order } = await createOrder(deps(), {
    spaceId: unit.spaceId,
    offerId,
    slotId,
    date: DAY,
    quantity: 2,
    contact: { email: 'guest@example.test', name: 'Ana', phone: '+385 91 000 0000' },
    hold: { expiresAt: HOLD_UNTIL },
  });
  const ref = { orderId: order.id, proposalId: order.currentProposalId as string };
  await confirmHeldOrder(deps(), ref);
  return { ref, slotId };
}

async function remaining(slotId: string) {
  const [slot] = await testDb.db.select().from(allotmentSlots).where(eq(allotmentSlots.id, slotId));
  return slot?.remaining;
}

async function acknowledgedAt(proposalId: string) {
  const [p] = await testDb.db
    .select()
    .from(orderProposals)
    .where(eq(orderProposals.id, proposalId));
  return p?.providerAcknowledgedAt;
}

async function status(orderId: string) {
  return (await getOrder(testDb.db, orderId))?.order.status;
}

describe('the link token', () => {
  it('is issued once and only its hash is stored', async () => {
    const { ref } = await confirmedOrder();
    const token = await issueProviderLink(testDb.db, SECRET, ref.orderId);
    expect(await issueProviderLink(testDb.db, SECRET, ref.orderId)).toBe(token);
    const [order] = await testDb.db.select().from(orders).where(eq(orders.id, ref.orderId));
    expect(order?.providerLinkTokenHash).toBe(hashToken(token));
    expect(JSON.stringify(order)).not.toContain(token);
    const { rows } = await testDb.db.execute(
      sql`select 1 from pgboss.job where data::text like ${`%${token}%`}`,
    );
    expect(rows).toHaveLength(0);
    expect((await findOrderByLinkToken(testDb.db, token))?.order.id).toBe(ref.orderId);
  });

  it('cannot be enumerated', async () => {
    const { ref } = await confirmedOrder();
    const token = await issueProviderLink(testDb.db, SECRET, ref.orderId);
    const flipped = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
    const misses = [
      providerLinkToken(SECRET, randomUUID()),
      providerLinkToken('another-secret-entirely-000000000000000', ref.orderId),
      flipped,
      ref.orderId,
      hashToken(token),
      '',
      `${token}x`,
      "' or 1=1 --",
    ];
    for (const miss of misses) {
      expect(await findOrderByLinkToken(testDb.db, miss), miss).toBeUndefined();
    }
  });
});

describe('the page view', () => {
  it('shows the current terms, the configured guest fields and both actions', async () => {
    const { ref } = await confirmedOrder();
    const token = await issueProviderLink(testDb.db, SECRET, ref.orderId);
    const found = await findOrderByLinkToken(testDb.db, token);
    if (!found) throw new Error('not found');
    const view = providerLinkView(found);
    expect(view).toMatchObject({
      proposalId: ref.proposalId,
      language: 'hr',
      offerTitle: 'Kayak tour',
      date: DAY,
      startTime: '09:00',
      quantity: 2,
      guest: { name: 'Ana' },
      status: 'confirmed',
      final: false,
      acknowledgedAt: null,
      actions: ['acknowledge', 'cannot_fulfil'],
    });
    expect(view.guest.phone).toBeUndefined();
  });

  it('is closed with no actions once the Order is final', async () => {
    const { ref } = await confirmedOrder();
    await cancel(deps(), { ...ref, trigger: 'guest' });
    const token = await issueProviderLink(testDb.db, SECRET, ref.orderId);
    const found = await findOrderByLinkToken(testDb.db, token);
    if (!found) throw new Error('not found');
    const view = providerLinkView(found);
    expect(view.final).toBe(true);
    expect(view.actions).toEqual([]);
    expect(view.guest).toEqual({});
    expect((await acknowledgeOrder(deps(), ref)).outcome).toBe('rejected');
    expect((await cannotFulfil(deps(), ref)).outcome).toBe('rejected');
    expect(await status(ref.orderId)).toBe('cancelled');
  });
});

describe('Got it', () => {
  it('records the acknowledgement once, without a status change', async () => {
    const { ref } = await confirmedOrder();
    expect((await acknowledgeOrder(deps(), ref)).outcome).toBe('applied');
    const at = await acknowledgedAt(ref.proposalId);
    expect(at?.getTime()).toBe(NOW.getTime());
    expect((await acknowledgeOrder(deps(), ref)).outcome).toBe('unchanged');
    expect(await status(ref.orderId)).toBe('confirmed');
  });
});

describe("Can't fulfil", () => {
  it('cancels the Order, returns the seat and alerts the admin', async () => {
    const { ref, slotId } = await confirmedOrder();
    expect(await remaining(slotId)).toBe(2);
    const result = await cannotFulfil(deps(), ref);
    expect(result.outcome).toBe('applied');
    expect(result.order.status).toBe('cancelled');
    expect(await remaining(slotId)).toBe(4);
    const { rows } = await testDb.db.execute<{ kind: string }>(
      sql`select data->>'kind' as kind from pgboss.job
          where name = ${QUEUES.orderNotify} and data->>'orderId' = ${ref.orderId}`,
    );
    expect(rows.map((r) => r.kind)).toContain('admin_provider_cancelled');
    expect((await cannotFulfil(deps(), ref)).outcome).toBe('rejected');
    expect(await remaining(slotId)).toBe(4);
  });
});

describe('a stale page', () => {
  it('does nothing for a proposal that is not current', async () => {
    const { ref, slotId } = await confirmedOrder();
    const old = { orderId: ref.orderId, proposalId: randomUUID() };
    expect((await acknowledgeOrder(deps(), old)).outcome).toBe('stale');
    expect((await cannotFulfil(deps(), old)).outcome).toBe('stale');
    expect(await status(ref.orderId)).toBe('confirmed');
    expect(await remaining(slotId)).toBe(2);
    expect(await acknowledgedAt(ref.proposalId)).toBeNull();
  });

  it('does nothing after new terms replaced the ones it showed', async () => {
    const provider = await seedProvider(testDb.db);
    const { offerId } = await seedOrderableOffer(testDb.db, {
      providerId: provider.id,
      availabilityMode: 'on_request',
    });
    const { order } = await createOrder(deps(), {
      spaceId: unit.spaceId,
      offerId,
      date: DAY,
      quantity: 2,
      contact: { email: 'guest@example.test', name: 'Ana' },
    });
    const v1 = order.currentProposalId as string;
    await propose(deps(), {
      orderId: order.id,
      proposalId: v1,
      trigger: 'admin',
      proposer: 'admin',
      terms: { date: '2027-05-05', quantity: 2 },
      cardExpiresAt: new Date('2027-05-01T12:00:00Z'),
    });
    const v2 = (await getOrder(testDb.db, order.id))?.proposal.id as string;
    // Terms the admin proposed need no second ask: the guest's yes places the hold.
    await guestConfirm(deps(), {
      orderId: order.id,
      proposalId: v2,
      trigger: 'guest',
      hold: { expiresAt: new Date('2027-05-01T10:30:00Z') },
    });
    await confirm(deps(), { orderId: order.id, proposalId: v2, trigger: 'admin' });
    expect(await status(order.id)).toBe('confirmed');

    const stale = { orderId: order.id, proposalId: v1 };
    expect((await acknowledgeOrder(deps(), stale)).outcome).toBe('stale');
    expect((await cannotFulfil(deps(), stale)).outcome).toBe('stale');
    expect(await status(order.id)).toBe('confirmed');
    expect(await acknowledgedAt(v1)).toBeNull();
    expect(await acknowledgedAt(v2)).toBeNull();
  });
});

/** A pay-direct on-request Order waiting for the Provider, with its page view. */
async function pendingOrder(orderKind: 'booking' | 'request' = 'booking') {
  const provider = await seedProvider(testDb.db);
  const { offerId } = await seedOrderableOffer(testDb.db, {
    providerId: provider.id,
    availabilityMode: 'on_request',
    orderKind,
  });
  const { order } = await createOrder(deps(), {
    spaceId: unit.spaceId,
    offerId,
    date: DAY,
    quantity: 2,
    contact: { email: 'guest@example.test', name: 'Ana' },
  });
  const ref = { orderId: order.id, proposalId: order.currentProposalId as string };
  const found = await findOrderByLinkToken(
    testDb.db,
    await issueProviderLink(testDb.db, SECRET, order.id),
  );
  if (!found) throw new Error('not found');
  return { ref, view: providerLinkView(found) };
}

describe('an on-request Order waiting for the Provider', () => {
  it('shows Accept, Suggest another time and Decline with the answer-by time', async () => {
    const { view } = await pendingOrder();
    expect(view).toMatchObject({
      status: 'pending_provider',
      actions: ['accept', 'suggest_time', 'decline'],
      respondBy: '2027-05-01T12:30',
      stayFrom: unit.stay.checkIn,
      stayTo: unit.stay.checkout,
      zone: 'Europe/Zagreb',
      currency: 'EUR',
      needsPrice: false,
    });
  });

  it('shows Accept with price for a request-kind Offer, which needs a price', async () => {
    const { view } = await pendingOrder('request');
    expect(view.actions).toEqual(['accept_with_price', 'suggest_time', 'decline']);
    expect(view.needsPrice).toBe(true);
    expect(view.priceMinor).toBeNull();
  });

  it('answers through the link: accept, decline and new terms', async () => {
    const accepted = await pendingOrder();
    expect((await acceptOrder(deps(), accepted.ref)).order.status).toBe('confirmed');
    const declined = await pendingOrder();
    expect((await declineOrder(deps(), declined.ref)).order.status).toBe('declined');
    const proposed = await pendingOrder();
    const result = await proposeOrder(deps(), proposed.ref, { date: DAY, time: '17:00' });
    expect(result.order.status).toBe('awaiting_confirmation');
    expect((await acceptOrder(deps(), proposed.ref)).outcome).toBe('stale');
  });
});
