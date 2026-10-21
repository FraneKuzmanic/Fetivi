import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { allotmentSlots } from '../../db/schema/offers';
import { inventoryHolds, orderProposals, orders } from '../../db/schema/orders';
import { createJobQueue, ensureQueues, type JobQueue, QUEUES } from '../../jobs/queue';
import { createOrder, type OrderDeps, OrderRuleError } from '../../orders/machine';
import { createTestDatabase, type TestDatabase } from '../../testing';
import {
  type SeededGuestUnit,
  seedGuestUnit,
  seedOrderableOffer,
  seedProvider,
} from '../../testing/fixtures';
import { confirmHeldOrder, handleInboundCancellation } from '.';
import { allotmentAdapter } from './allotment';
import { AdapterError } from './interface';

let testDb: TestDatabase;
let boss: PgBoss;
let queue: JobQueue;
let unit: SeededGuestUnit;

const NOW = new Date('2027-05-01T10:00:00Z');
const DAY = '2027-05-04';
const SLOT_AT = new Date('2027-05-04T07:00:00Z');
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

async function providerOffer(capacity: number) {
  const provider = await seedProvider(testDb.db);
  const { offerId, slotId } = await seedOrderableOffer(testDb.db, {
    providerId: provider.id,
    availabilityMode: 'allotment',
    capacity,
    startsAt: SLOT_AT,
  });
  if (!slotId) throw new Error('no slot');
  return { offerId, slotId };
}

async function remaining(slotId: string) {
  const [slot] = await testDb.db.select().from(allotmentSlots).where(eq(allotmentSlots.id, slotId));
  return slot?.remaining;
}

async function notifyKinds(orderId: string) {
  const { rows } = await testDb.db.execute<{ kind: string }>(
    sql`select data->>'kind' as kind from pgboss.job
        where name = ${QUEUES.orderNotify} and data->>'orderId' = ${orderId}`,
  );
  return rows.map((r) => r.kind).sort();
}

const orderInput = (offerId: string, slotId: string, quantity = 1) => ({
  id: randomUUID(),
  spaceId: unit.spaceId,
  offerId,
  slotId,
  date: DAY,
  quantity,
  contact: { email: 'guest@example.test', name: 'Ana', phone: '+385 91 000 0000' },
  hold: { expiresAt: HOLD_UNTIL },
});

/** An Order row in `confirming` with its first proposal, for adapter-only holds. */
async function bareProposal(offerId: string, slotId: string) {
  const [order] = await testDb.db
    .insert(orders)
    .values({
      spaceId: unit.spaceId,
      stayId: unit.stayId,
      offerId,
      availabilityMode: 'allotment',
      paymentMode: 'direct',
      status: 'confirming',
      date: DAY,
      quantity: 1,
      guestEmail: 'guest@example.test',
      cancellationPolicy: 'Free until 24 hours before.',
      freeCancelHoursBefore: 24,
      refundPercentAfter: 0,
      currency: 'EUR',
      priceUnit: 'person',
      commissionBp: 0,
    })
    .returning();
  if (!order) throw new Error('no order');
  const [proposal] = await testDb.db
    .insert(orderProposals)
    .values({
      orderId: order.id,
      version: 1,
      date: DAY,
      startsAt: SLOT_AT,
      slotId,
      quantity: 1,
      priceMinor: 2500,
      currency: 'EUR',
      proposer: 'offer',
    })
    .returning();
  if (!proposal) throw new Error('no proposal');
  return { orderId: order.id, proposalId: proposal.id };
}

describe('the last seat', () => {
  it('goes to exactly one of many parallel adapter holds', async () => {
    const { offerId, slotId } = await providerOffer(1);
    const refs = await Promise.all(Array.from({ length: 8 }, () => bareProposal(offerId, slotId)));
    const results = await Promise.allSettled(
      refs.map((ref) =>
        testDb.db.transaction((tx) =>
          allotmentAdapter.hold(
            { db: tx, now: () => NOW },
            { ...ref, slotId, quantity: 1, expiresAt: HOLD_UNTIL },
          ),
        ),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(7);
    for (const r of rejected) {
      expect(r.reason).toBeInstanceOf(AdapterError);
      expect((r.reason as AdapterError).code).toBe('sold-out');
    }
    expect(await remaining(slotId)).toBe(0);
    const holds = await testDb.db
      .select()
      .from(inventoryHolds)
      .where(eq(inventoryHolds.slotId, slotId));
    expect(holds).toHaveLength(1);
  });

  it('goes to exactly one of many parallel Orders, leaving no orphan Order', async () => {
    const { offerId, slotId } = await providerOffer(1);
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => createOrder(deps(), orderInput(offerId, slotId))),
    );
    const created = results.filter((r) => r.status === 'fulfilled');
    expect(created).toHaveLength(1);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(5);
    for (const r of rejected) {
      expect(r.reason).toBeInstanceOf(OrderRuleError);
      expect((r.reason as OrderRuleError).code).toBe('sold-out');
    }
    const rows = await testDb.db.select().from(orders).where(eq(orders.offerId, offerId));
    expect(rows).toHaveLength(1);
    expect(await remaining(slotId)).toBe(0);
  });
});

describe('confirmHeldOrder', () => {
  it('confirms under the Order id and tells guest and Provider once', async () => {
    const { offerId, slotId } = await providerOffer(4);
    const { order } = await createOrder(deps(), orderInput(offerId, slotId, 2));
    const ref = { orderId: order.id, proposalId: order.currentProposalId as string };
    const confirmed = await confirmHeldOrder(deps(), ref);
    expect(confirmed.outcome).toBe('applied');
    expect(confirmed.order.status).toBe('confirmed');
    expect(confirmed.order.providerExternalRef).toBe(order.id);
    expect(await remaining(slotId)).toBe(2);
    expect(await notifyKinds(order.id)).toEqual(['order_confirmed', 'provider_confirmed']);

    expect((await confirmHeldOrder(deps(), ref)).outcome).toBe('unchanged');
    expect(await notifyKinds(order.id)).toEqual(['order_confirmed', 'provider_confirmed']);
    expect(await remaining(slotId)).toBe(2);
  });

  it('is stale once the hold is gone', async () => {
    const { offerId, slotId } = await providerOffer(4);
    const { order } = await createOrder(deps(), orderInput(offerId, slotId));
    const ref = { orderId: order.id, proposalId: order.currentProposalId as string };
    await allotmentAdapter.release({ db: testDb.db, now: () => NOW }, ref);
    const result = await confirmHeldOrder(deps(), ref);
    expect(result.outcome).toBe('stale');
    expect(result.order.status).toBe('confirming');
  });
});

describe('a Provider cancellation', () => {
  it('cancels the Order, returns the seat and alerts the admin', async () => {
    const { offerId, slotId } = await providerOffer(4);
    const { order } = await createOrder(deps(), orderInput(offerId, slotId, 2));
    const ref = { orderId: order.id, proposalId: order.currentProposalId as string };
    await confirmHeldOrder(deps(), ref);
    expect(await remaining(slotId)).toBe(2);

    const result = await handleInboundCancellation(
      deps(),
      allotmentAdapter,
      { reference: order.id },
      'provider_link',
    );
    expect(result?.outcome).toBe('applied');
    expect(result?.order.status).toBe('cancelled');
    expect(await remaining(slotId)).toBe(4);
    expect(await notifyKinds(order.id)).toEqual([
      'admin_provider_cancelled',
      'order_cancelled',
      'order_confirmed',
      'provider_confirmed',
    ]);

    const again = await handleInboundCancellation(
      deps(),
      allotmentAdapter,
      { reference: order.id },
      'provider_link',
    );
    expect(again?.outcome).toBe('unchanged');
    expect(await remaining(slotId)).toBe(4);
  });

  it('is null for a reference no Order has', async () => {
    expect(
      await handleInboundCancellation(
        deps(),
        allotmentAdapter,
        { reference: randomUUID() },
        'provider_link',
      ),
    ).toBe(null);
  });
});
