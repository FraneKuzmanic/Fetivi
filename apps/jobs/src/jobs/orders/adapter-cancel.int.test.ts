import {
  allotmentAdapter,
  cancel,
  confirm,
  createJobQueue,
  createOrder,
  ensureQueues,
  type JobQueue,
  type OrderDeps,
  type ProposalRef,
  type ProviderAdapter,
  QUEUES,
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
import { orderAdapterCancelJob } from './adapter-cancel';

// The live engine's cancel (35): enqueued with the cancel of a live Order, run outside it.

let testDb: TestDatabase;
let boss: PgBoss;
let queue: JobQueue;
let unit: SeededGuestUnit;

const NOW = new Date('2027-05-01T10:00:00Z');

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

/** A confirmed pay-direct Order of a live Offer, confirmed by the engine. */
async function liveOrder() {
  const provider = await seedProvider(testDb.db);
  const { offerId } = await seedOrderableOffer(testDb.db, {
    providerId: provider.id,
    availabilityMode: 'live',
  });
  const { order } = await createOrder(orderDeps(), {
    spaceId: unit.spaceId,
    offerId,
    date: '2027-05-04',
    quantity: 1,
    contact: { email: 'guest@example.test' },
    hold: { expiresAt: new Date(NOW.getTime() + 15 * 60_000), externalRef: 'bk-hold' },
  });
  const ref = { orderId: order.id, proposalId: order.currentProposalId as string };
  await confirm(orderDeps(), { ...ref, trigger: 'adapter' });
  return ref;
}

/** The allotment adapter, recording its cancels; `fail` makes the call throw. */
function fakeLive(fail = false) {
  const calls: ProposalRef[] = [];
  const adapter: ProviderAdapter = {
    ...allotmentAdapter,
    mode: 'live',
    async cancel(_ctx, ref) {
      if (fail) throw new Error('engine unavailable');
      calls.push(ref);
    },
  };
  return { calls, adapters: () => adapter };
}

async function jobsOf(orderId: string) {
  const { rows } = await testDb.pool.query<{ data: ProposalRef }>(
    `select data from pgboss.job where name = $1 and data->>'orderId' = $2`,
    [QUEUES.orderAdapterCancel, orderId],
  );
  return rows.map((r) => r.data);
}

describe('order-adapter-cancel', () => {
  it('is enqueued once with the cancel of a live Order and cancels in the engine', async () => {
    const ref = await liveOrder();
    const result = await cancel(orderDeps(), { ...ref, trigger: 'guest' });
    expect(result.outcome).toBe('applied');
    expect(await cancel(orderDeps(), { ...ref, trigger: 'guest' })).toMatchObject({
      outcome: 'unchanged',
    });
    expect(await jobsOf(ref.orderId)).toEqual([ref]);

    const live = fakeLive();
    await orderAdapterCancelJob({ ...orderDeps(), adapters: live.adapters }).handler(ref);
    expect(live.calls).toEqual([ref]);
  });

  it('leaves an Order that is not cancelled alone', async () => {
    const ref = await liveOrder();
    const live = fakeLive();
    await orderAdapterCancelJob({ ...orderDeps(), adapters: live.adapters }).handler(ref);
    expect(live.calls).toEqual([]);
    expect(await jobsOf(ref.orderId)).toEqual([]);
  });

  it('throws when the engine fails, so pg-boss retries', async () => {
    const ref = await liveOrder();
    await cancel(orderDeps(), { ...ref, trigger: 'guest' });
    const live = fakeLive(true);
    await expect(
      orderAdapterCancelJob({ ...orderDeps(), adapters: live.adapters }).handler(ref),
    ).rejects.toThrow('engine unavailable');
  });
});
