import { eq, sql } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accounts } from '../db/schema/accounts';
import { allotmentSlots } from '../db/schema/offers';
import { inventoryHolds, orderEvents, orderProposals, orders } from '../db/schema/orders';
import { createJobQueue, ensureQueues, type JobQueue, QUEUES } from '../jobs/queue';
import { createTestDatabase, type TestDatabase } from '../testing';
import { type SeededGuestUnit, seedGuestUnit, seedOrderableOffer } from '../testing/fixtures';
import { endOfCheckoutDay } from '../time';
import {
  type CreateOrderInput,
  cancel,
  complete,
  confirm,
  createOrder,
  decline,
  getOrder,
  guestConfirm,
  type OrderDeps,
  OrderRuleError,
  propose,
  runOrderTimer,
} from './machine';
import { enqueueNotification, orderJobId } from './timers';

let testDb: TestDatabase;
let boss: PgBoss;
let queue: JobQueue;
let unit: SeededGuestUnit;

const NOW = new Date('2027-05-01T10:00:00Z');
// seedGuestUnit: check-in two days after NOW, three nights.
const CHECK_IN = '2027-05-03';
const CHECKOUT = '2027-05-06';
const DAY = '2027-05-04';
const SLOT_AT = new Date('2027-05-04T07:00:00Z'); // 09:00 in Zagreb
const HOLD_UNTIL = new Date('2027-05-01T10:30:00Z');

let clock = NOW;
const deps = (): OrderDeps => ({ db: testDb.db, queue, now: () => clock });

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

type JobRow = {
  id: string;
  name: string;
  data: Record<string, string>;
  /** start_after in epoch milliseconds. */
  start_ms: number;
};

async function jobsOf(orderId: string, name?: string): Promise<JobRow[]> {
  const { rows } = await testDb.db.execute<JobRow>(
    sql`select id, name, data, (extract(epoch from start_after) * 1000)::float8 as start_ms from pgboss.job where data->>'orderId' = ${orderId} ${
      name ? sql`and name = ${name}` : sql``
    } order by created_on, id`,
  );
  return rows;
}

const notifyKinds = async (orderId: string) =>
  (await jobsOf(orderId, QUEUES.orderNotify)).map((j) => j.data.kind);

const events = (orderId: string) =>
  testDb.db
    .select()
    .from(orderEvents)
    .where(eq(orderEvents.orderId, orderId))
    .orderBy(orderEvents.id);

async function remaining(slotId: string) {
  const [slot] = await testDb.db.select().from(allotmentSlots).where(eq(allotmentSlots.id, slotId));
  return slot?.remaining;
}

async function holdOf(proposalId: string) {
  const [hold] = await testDb.db
    .select()
    .from(inventoryHolds)
    .where(eq(inventoryHolds.proposalId, proposalId));
  return hold;
}

async function allotment(capacity = 4) {
  const seeded = await seedOrderableOffer(testDb.db, {
    hostId: unit.hostId,
    availabilityMode: 'allotment',
    capacity,
    startsAt: SLOT_AT,
  });
  return { offerId: seeded.offerId, slotId: seeded.slotId as string };
}

const input = (over: Partial<CreateOrderInput> & { offerId: string }): CreateOrderInput => ({
  spaceId: unit.spaceId,
  date: DAY,
  quantity: 2,
  contact: { email: 'guest@example.test', name: 'Ana' },
  hold: { expiresAt: HOLD_UNTIL },
  ...over,
});

async function current(orderId: string) {
  const found = await getOrder(testDb.db, orderId);
  if (!found) throw new Error('no order');
  return found;
}

describe('allotment Order', () => {
  it('creates in confirming with a held seat and a hold timer, then confirms', async () => {
    clock = NOW;
    const { offerId, slotId } = await allotment();
    const { order, created } = await createOrder(deps(), input({ offerId, slotId }));
    expect(created).toBe(true);
    expect(order.status).toBe('confirming');
    expect(order.paymentStatus).toBe('none');
    const { proposal } = await current(order.id);
    expect(proposal.priceMinor).toBe(5000);
    expect(await remaining(slotId)).toBe(2);
    expect((await holdOf(proposal.id))?.state).toBe('held');
    const timers = await jobsOf(order.id, QUEUES.orderTimer);
    expect(timers).toHaveLength(1);
    expect(timers[0]?.id).toBe(orderJobId(order.id, proposal.id, 'hold_expiry'));
    expect(timers[0]?.start_ms).toBe(HOLD_UNTIL.getTime());
    expect((await events(order.id)).map((e) => [e.fromStatus, e.toStatus, e.trigger])).toEqual([
      [null, 'awaiting_confirmation', 'guest'],
      ['awaiting_confirmation', 'confirming', 'guest'],
    ]);

    const ref = { orderId: order.id, proposalId: proposal.id };
    const confirmed = await confirm(deps(), {
      ...ref,
      trigger: 'adapter',
      providerExternalRef: 'ALLOT-1',
    });
    expect(confirmed.outcome).toBe('applied');
    expect(confirmed.order.status).toBe('confirmed');
    expect(confirmed.order.paymentStatus).toBe('none');
    expect(confirmed.order.providerExternalRef).toBe('ALLOT-1');
    expect((await holdOf(proposal.id))?.state).toBe('committed');
    expect((await notifyKinds(order.id)).sort()).toEqual(['order_confirmed', 'provider_confirmed']);
    const completion = await jobsOf(order.id, QUEUES.orderTimer);
    const done = completion.find((j) => j.data.operation === 'completion');
    expect(done?.start_ms).toBe(endOfCheckoutDay(DAY, 'Europe/Zagreb').getTime());

    // A duplicate delivery changes nothing.
    const eventsBefore = (await events(order.id)).length;
    const jobsBefore = (await jobsOf(order.id)).length;
    expect((await confirm(deps(), { ...ref, trigger: 'adapter' })).outcome).toBe('unchanged');
    // A trigger that may never confirm is rejected, even though the Order is confirmed.
    expect((await confirm(deps(), { ...ref, trigger: 'guest' })).outcome).toBe('rejected');
    expect(await events(order.id)).toHaveLength(eventsBefore);
    expect(await jobsOf(order.id)).toHaveLength(jobsBefore);

    // The hold timer after confirmation finds no held hold: stale.
    clock = new Date(HOLD_UNTIL.getTime() + 60_000);
    const late = await runOrderTimer(deps(), { ...ref, operation: 'hold_expiry' });
    expect(late.outcome).toBe('stale');
    expect(late.order.status).toBe('confirmed');

    // Cancelling through the Provider link returns the seats.
    const cancelled = await cancel(deps(), { ...ref, trigger: 'provider_link' });
    expect(cancelled.order.status).toBe('cancelled');
    expect(await remaining(slotId)).toBe(4);
    expect((await holdOf(proposal.id))?.state).toBe('released');
    expect((await notifyKinds(order.id)).sort()).toEqual([
      'admin_provider_cancelled',
      'order_cancelled',
      'order_confirmed',
      'provider_confirmed',
    ]);

    // The completion timer after cancellation no longer applies: stale.
    const afterCancel = await runOrderTimer(deps(), { ...ref, operation: 'completion' });
    expect(afterCancel.outcome).toBe('stale');
    expect(afterCancel.order.status).toBe('cancelled');
  });

  it('rejects illegal transitions without writing', async () => {
    clock = NOW;
    const { offerId, slotId } = await allotment();
    const { order } = await createOrder(deps(), input({ offerId, slotId }));
    const { proposal } = await current(order.id);
    const ref = { orderId: order.id, proposalId: proposal.id };
    const before = (await events(order.id)).length;
    const completed = await complete(deps(), { ...ref, trigger: 'admin' });
    expect(completed.outcome).toBe('rejected');
    expect((await decline(deps(), { ...ref, trigger: 'guest' })).outcome).toBe('rejected');
    expect(await events(order.id)).toHaveLength(before);
    expect((await current(order.id)).order.status).toBe('confirming');
  });

  it('expires on the hold timer and returns the seats', async () => {
    clock = NOW;
    const { offerId, slotId } = await allotment();
    const { order } = await createOrder(deps(), input({ offerId, slotId }));
    const { proposal } = await current(order.id);
    const ref = { orderId: order.id, proposalId: proposal.id, operation: 'hold_expiry' as const };
    expect((await runOrderTimer(deps(), ref)).outcome).toBe('stale'); // not due yet
    clock = new Date(HOLD_UNTIL.getTime() + 1000);
    const expired = await runOrderTimer(deps(), ref);
    expect(expired.outcome).toBe('applied');
    expect(expired.order.status).toBe('expired');
    expect(await remaining(slotId)).toBe(4);
    expect(await notifyKinds(order.id)).toEqual(['order_expired']);
    expect((await runOrderTimer(deps(), ref)).outcome).toBe('stale'); // duplicate delivery
  });

  it('creates one Order for the same id, sequentially and concurrently', async () => {
    clock = NOW;
    const { offerId, slotId } = await allotment();
    const id = crypto.randomUUID();
    const first = await createOrder(deps(), input({ id, offerId, slotId }));
    const again = await createOrder(deps(), input({ id, offerId, slotId }));
    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(again.order.id).toBe(id);

    const id2 = crypto.randomUUID();
    const results = await Promise.all([
      createOrder(deps(), input({ id: id2, offerId, slotId })),
      createOrder(deps(), input({ id: id2, offerId, slotId })),
    ]);
    expect(results.map((r) => r.created).sort()).toEqual([false, true]);
    const holds = await testDb.db
      .select()
      .from(inventoryHolds)
      .where(eq(inventoryHolds.slotId, slotId));
    expect(holds).toHaveLength(2);
    expect(await remaining(slotId)).toBe(0);
  });

  it('rolls back a sold-out create entirely', async () => {
    clock = NOW;
    const { offerId, slotId } = await allotment(1);
    await createOrder(deps(), input({ offerId, slotId, quantity: 1 }));
    const id = crypto.randomUUID();
    await expect(
      createOrder(deps(), input({ id, offerId, slotId, quantity: 1 })),
    ).rejects.toMatchObject({ code: 'sold-out' });
    expect(await testDb.db.select().from(orders).where(eq(orders.id, id))).toHaveLength(0);
    expect(await remaining(slotId)).toBe(0);
  });

  it('leaves nothing behind when the caller crashes before commit, and a retry succeeds', async () => {
    clock = NOW;
    const { offerId, slotId } = await allotment();
    const id = crypto.randomUUID();
    await expect(
      testDb.db.transaction(async (tx) => {
        await createOrder({ ...deps(), db: tx }, input({ id, offerId, slotId }));
        throw new Error('crash');
      }),
    ).rejects.toThrow('crash');
    expect(await testDb.db.select().from(orders).where(eq(orders.id, id))).toHaveLength(0);
    expect(await jobsOf(id)).toHaveLength(0);
    expect(await remaining(slotId)).toBe(4);
    const retry = await createOrder(deps(), input({ id, offerId, slotId }));
    expect(retry.created).toBe(true);
    expect(await events(id)).toHaveLength(2);
    expect(await jobsOf(id)).toHaveLength(1);
    expect(await remaining(slotId)).toBe(2);
  });
});

describe('create rules', () => {
  it('accepts the check-in and checkout days and rejects a day outside the Stay', async () => {
    clock = NOW;
    const { offerId } = await seedOrderableOffer(testDb.db, {
      hostId: unit.hostId,
      availabilityMode: 'on_request',
    });
    for (const date of ['2027-05-02', '2027-05-07']) {
      const id = crypto.randomUUID();
      await expect(createOrder(deps(), input({ id, offerId, date }))).rejects.toMatchObject({
        code: 'date-outside-stay',
      });
      expect(await testDb.db.select().from(orders).where(eq(orders.id, id))).toHaveLength(0);
    }
    for (const date of [CHECK_IN, CHECKOUT]) {
      const { order } = await createOrder(deps(), input({ offerId, date }));
      expect(order.date).toBe(date);
    }
  });

  it('rejects a pay-online Offer until payments exist', async () => {
    const { offerId } = await seedOrderableOffer(testDb.db, {
      hostId: unit.hostId,
      availabilityMode: 'on_request',
      paymentMode: 'online',
    });
    await expect(createOrder(deps(), input({ offerId }))).rejects.toBeInstanceOf(OrderRuleError);
    await expect(createOrder(deps(), input({ offerId }))).rejects.toMatchObject({
      code: 'payment-mode-unsupported',
    });
  });

  it('prices a group Offer once and a request Offer not at all', async () => {
    const group = await seedOrderableOffer(testDb.db, {
      hostId: unit.hostId,
      availabilityMode: 'on_request',
      priceUnit: 'group',
      priceMinor: 9000,
    });
    const request = await seedOrderableOffer(testDb.db, {
      hostId: unit.hostId,
      availabilityMode: 'on_request',
      orderKind: 'request',
    });
    const a = await createOrder(deps(), input({ offerId: group.offerId, quantity: 3 }));
    const b = await createOrder(deps(), input({ offerId: request.offerId }));
    expect((await current(a.order.id)).proposal.priceMinor).toBe(9000);
    expect((await current(b.order.id)).proposal.priceMinor).toBeNull();
  });
});

describe('on-request Order and proposals', () => {
  it('waits for the Provider, alerts on a missed window, and supersedes on a new proposal', async () => {
    clock = NOW;
    const { offerId } = await seedOrderableOffer(testDb.db, {
      hostId: unit.hostId,
      availabilityMode: 'on_request',
    });
    const deadline = new Date('2027-05-01T10:30:00Z');
    const { order } = await createOrder(
      deps(),
      input({ offerId, hold: undefined, responseDeadline: deadline }),
    );
    expect(order.status).toBe('pending_provider');
    const { proposal: v1 } = await current(order.id);
    expect(await notifyKinds(order.id)).toEqual(['provider_request']);
    const windows = await jobsOf(order.id, QUEUES.orderTimer);
    expect(windows.map((j) => j.data.operation)).toEqual(['response_window']);

    // The missed window alerts once and changes nothing.
    const v1Window = {
      orderId: order.id,
      proposalId: v1.id,
      operation: 'response_window' as const,
    };
    const before = (await events(order.id)).length;
    expect((await runOrderTimer(deps(), v1Window)).outcome).toBe('applied');
    expect((await runOrderTimer(deps(), v1Window)).outcome).toBe('applied');
    expect(await notifyKinds(order.id)).toEqual(['provider_request', 'admin_window_missed']);
    expect(await events(order.id)).toHaveLength(before);
    expect((await current(order.id)).order.status).toBe('pending_provider');

    // The Provider suggests another time.
    const cardExpiresAt = new Date('2027-05-01T12:00:00Z');
    const proposed = await propose(deps(), {
      orderId: order.id,
      proposalId: v1.id,
      trigger: 'provider_link',
      proposer: 'provider_time',
      terms: { date: '2027-05-05', quantity: 2 },
      cardExpiresAt,
    });
    expect(proposed.outcome).toBe('applied');
    expect(proposed.order.status).toBe('awaiting_confirmation');
    expect(proposed.order.date).toBe('2027-05-05');
    const { proposal: v2 } = await current(order.id);
    expect(v2.version).toBe(2);
    expect(v2.priceMinor).toBe(v1.priceMinor);
    const [old] = await testDb.db.select().from(orderProposals).where(eq(orderProposals.id, v1.id));
    expect(old?.supersededAt).not.toBeNull();
    expect((await notifyKinds(order.id)).at(-1)).toBe('order_new_proposal');
    const card = (await jobsOf(order.id, QUEUES.orderTimer)).find(
      (j) => j.data.operation === 'card_expiry',
    );
    expect(card?.id).toBe(orderJobId(order.id, v2.id, 'card_expiry'));
    expect(card?.start_ms).toBe(cardExpiresAt.getTime());

    // Everything bound to the old proposal is now a no-op.
    const staleAccept = await confirm(deps(), {
      orderId: order.id,
      proposalId: v1.id,
      trigger: 'provider_link',
    });
    expect(staleAccept.outcome).toBe('stale');
    expect((await runOrderTimer(deps(), v1Window)).outcome).toBe('stale');
    // The card timer before its deadline is not due.
    const v2Card = { orderId: order.id, proposalId: v2.id, operation: 'card_expiry' as const };
    expect((await runOrderTimer(deps(), v2Card)).outcome).toBe('stale');

    // The guest confirms the new time; the Provider confirms it.
    const accepted = await guestConfirm(deps(), {
      orderId: order.id,
      proposalId: v2.id,
      trigger: 'guest',
    });
    expect(accepted.order.status).toBe('pending_provider');
    const ok = await confirm(deps(), {
      orderId: order.id,
      proposalId: v2.id,
      trigger: 'provider_link',
    });
    expect(ok.order.status).toBe('confirmed');
    // The card timer, due now, no longer applies once the guest confirmed: stale.
    clock = new Date(cardExpiresAt.getTime() + 1000);
    expect((await runOrderTimer(deps(), v2Card)).outcome).toBe('stale');
    clock = NOW;
    const all = await events(order.id);
    expect(all.at(-1)?.proposalId).toBe(v2.id);
    expect(all.every((e) => e.toPaymentStatus === 'none')).toBe(true);
  });

  it('rejects a proposal outside the Stay and on a confirming Order', async () => {
    clock = NOW;
    const onRequest = await seedOrderableOffer(testDb.db, {
      hostId: unit.hostId,
      availabilityMode: 'on_request',
    });
    const { order } = await createOrder(deps(), input({ offerId: onRequest.offerId }));
    const { proposal } = await current(order.id);
    const base = {
      orderId: order.id,
      proposalId: proposal.id,
      trigger: 'provider_link' as const,
      proposer: 'provider_time' as const,
      cardExpiresAt: new Date('2027-05-01T12:00:00Z'),
    };
    await expect(
      propose(deps(), { ...base, terms: { date: '2027-05-09', quantity: 2 } }),
    ).rejects.toMatchObject({ code: 'date-outside-stay' });

    const { offerId, slotId } = await allotment();
    const confirming = await createOrder(deps(), input({ offerId, slotId }));
    const p = await current(confirming.order.id);
    const result = await propose(deps(), {
      ...base,
      orderId: confirming.order.id,
      proposalId: p.proposal.id,
      terms: { date: DAY, quantity: 1 },
    });
    expect(result.outcome).toBe('rejected');
  });
});

describe('storage guarantees', () => {
  it('keeps order_events append-only', async () => {
    clock = NOW;
    const { offerId } = await seedOrderableOffer(testDb.db, {
      hostId: unit.hostId,
      availabilityMode: 'on_request',
    });
    const { order } = await createOrder(deps(), input({ offerId }));
    await expect(
      testDb.db.update(orderEvents).set({ note: 'x' }).where(eq(orderEvents.orderId, order.id)),
    ).rejects.toThrow();
    await expect(
      testDb.db.execute(sql`update order_events set note = 'x' where order_id = ${order.id}`),
    ).rejects.toMatchObject({ cause: { message: 'order_events is append-only' } });
  });

  it('lets deleting the acting admin null the actor, and nothing else', async () => {
    clock = NOW;
    const { offerId } = await seedOrderableOffer(testDb.db, {
      hostId: unit.hostId,
      availabilityMode: 'on_request',
    });
    const { order } = await createOrder(deps(), input({ offerId }));
    const { proposal } = await current(order.id);
    const [admin] = await testDb.db
      .insert(accounts)
      .values({ email: `admin-${order.id}@example.test`, passwordHash: 'x', role: 'admin' })
      .returning();
    if (!admin) throw new Error('no admin');
    await cancel(deps(), {
      orderId: order.id,
      proposalId: proposal.id,
      trigger: 'admin',
      actorId: admin.id,
    });
    await expect(
      testDb.db.execute(
        sql`update order_events set actor_id = null, note = 'x' where actor_id = ${admin.id}`,
      ),
    ).rejects.toMatchObject({ cause: { message: 'order_events is append-only' } });

    await testDb.db.delete(accounts).where(eq(accounts.id, admin.id));
    const cancelled = (await events(order.id)).at(-1);
    expect(cancelled?.toStatus).toBe('cancelled');
    expect(cancelled?.actorId).toBeNull();
  });

  it('enqueues a notification once per Order, proposal and kind', async () => {
    const data = {
      orderId: crypto.randomUUID(),
      proposalId: crypto.randomUUID(),
      kind: 'order_confirmed' as const,
    };
    await enqueueNotification(testDb.db, queue, data);
    await enqueueNotification(testDb.db, queue, data);
    expect(await jobsOf(data.orderId, QUEUES.orderNotify)).toHaveLength(1);
  });
});
