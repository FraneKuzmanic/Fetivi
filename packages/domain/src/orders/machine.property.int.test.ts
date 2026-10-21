import { randomUUID } from 'node:crypto';
import { inArray, sql } from 'drizzle-orm';
import fc from 'fast-check';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { allotmentSlots } from '../db/schema/offers';
import { inventoryHolds, orderEvents, orderProposals, orders } from '../db/schema/orders';
import { createJobQueue, ensureQueues, type JobQueue, QUEUES } from '../jobs/queue';
import { createTestDatabase, type TestDatabase } from '../testing';
import { type SeededGuestUnit, seedGuestUnit, seedOrderableOffer } from '../testing/fixtures';
import {
  cancel,
  confirm,
  createOrder,
  decline,
  expire,
  fail,
  getOrder,
  guestConfirm,
  type OrderDeps,
  OrderRuleError,
  propose,
  runOrderTimer,
} from './machine';
import type { OrderTimerJobData } from './timers';
import { REQUIRED_NOTIFICATION } from './transitions';
import { isFinalOrderStatus } from './vocabulary';

// Rebuilt from spike S2's property test for the pay-direct invariants: random interleavings of
// guest, Provider, adapter, admin and timer events, with crashes before commit and duplicate
// deliveries, checked after every step and after draining every timer.
// ORDER_PROPERTY_RUNS (default 25) sets the volume; ORDER_PROPERTY_SEED replays a failure.

const RUNS = Number(process.env.ORDER_PROPERTY_RUNS ?? 25);
const SEED = process.env.ORDER_PROPERTY_SEED ? Number(process.env.ORDER_PROPERTY_SEED) : undefined;

const NOW = new Date('2027-05-01T10:00:00Z');
const DATES = ['2027-05-03', '2027-05-04', '2027-05-06'] as const; // check-in, a day, checkout
const SLOT_AT = new Date('2027-05-04T07:00:00Z');
const MINUTE = 60_000;

let testDb: TestDatabase;
let boss: PgBoss;
let queue: JobQueue;
let unit: SeededGuestUnit;

beforeAll(async () => {
  testDb = await createTestDatabase();
  boss = new PgBoss({ connectionString: testDb.url, supervise: false, schedule: false });
  boss.on('error', console.error);
  await boss.start();
  await ensureQueues(boss);
  queue = createJobQueue(boss);
  unit = await seedGuestUnit(testDb.db, { now: NOW });
  // Counts status changes independently of order_events, as S2 did.
  await testDb.db.execute(sql`
    create table test_status_changes (order_id uuid primary key, n int not null);
    create function test_count_status() returns trigger language plpgsql as $$
    begin
      if tg_op = 'INSERT' then
        insert into test_status_changes values (new.id, 1);
      elsif old.status is distinct from new.status then
        update test_status_changes set n = n + 1 where order_id = new.id;
      end if;
      return new;
    end $$;
    create trigger test_count_status after insert or update of status on orders
      for each row execute function test_count_status();
  `);
});

afterAll(async () => {
  await boss?.stop({ graceful: false, timeout: 1000 });
  await testDb?.drop();
});

type Step =
  | { kind: 'create'; offer: number; quantity: number; sameId: boolean }
  | {
      kind: 'adapterConfirm' | 'adapterFail' | 'guestCancel' | 'providerCantFulfil' | 'adminExpire';
      order: number;
    }
  | { kind: 'providerAccept' | 'providerDecline'; order: number; stalePage: boolean }
  | { kind: 'providerPropose'; order: number; stalePage: boolean; date: number; quantity: number }
  | { kind: 'guestConfirm'; order: number; staleCard: boolean }
  | { kind: 'advance'; minutes: number; shuffle: number };
type Action = Step & { crash: boolean; duplicate: boolean };

// Few Orders per run, so actions pile up on the same Order and reach its later proposals.
const orderIdx = fc.nat(3);
const stepArb: fc.Arbitrary<Step> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant('create' as const),
      offer: fc.nat(2),
      quantity: fc.integer({ min: 1, max: 3 }),
      sameId: fc.boolean(),
    }),
  },
  fc.record({
    kind: fc.constantFrom(
      'adapterConfirm' as const,
      'adapterFail' as const,
      'guestCancel' as const,
      'providerCantFulfil' as const,
      'adminExpire' as const,
    ),
    order: orderIdx,
  }),
  fc.record({
    kind: fc.constantFrom('providerAccept' as const, 'providerDecline' as const),
    order: orderIdx,
    stalePage: fc.boolean(),
  }),
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant('providerPropose' as const),
      order: orderIdx,
      stalePage: fc.boolean(),
      date: fc.nat(2),
      quantity: fc.integer({ min: 1, max: 3 }),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant('guestConfirm' as const),
      order: orderIdx,
      staleCard: fc.boolean(),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant('advance' as const),
      minutes: fc.integer({ min: 1, max: 180 }),
      shuffle: fc.nat(),
    }),
  },
);
const actionArb: fc.Arbitrary<Action> = fc
  // One step in five crashes before commit, one in four is delivered twice.
  .tuple(stepArb, fc.nat(4), fc.nat(3))
  .map(([step, crash, duplicate]) => ({ ...step, crash: crash === 0, duplicate: duplicate === 0 }));

class Crash extends Error {}

/** One run's world: fresh Offers, a virtual clock and the Orders it created. */
class World {
  t = NOW;
  orders: { id: string; firstProposalId: string }[] = [];
  lastCreateId: string | undefined;
  /** Proposals whose response window alerted the admin (committed runs only). */
  windowAlerts = new Set<string>();
  readonly deps: OrderDeps;

  constructor(
    readonly offers: {
      offerId: string;
      slotId?: string;
      mode: 'allotment' | 'on_request' | 'live';
    }[],
    readonly capacity: number,
  ) {
    this.deps = { db: testDb.db, queue, now: () => this.t };
  }

  /** Runs `fn` once (or inside a crashing transaction) and again on a duplicate delivery. */
  async run<T>(action: { crash: boolean; duplicate: boolean }, fn: (d: OrderDeps) => Promise<T>) {
    const once = async (crash: boolean): Promise<T | undefined> => {
      try {
        if (!crash) return await fn(this.deps);
        await testDb.db.transaction(async (tx) => {
          await fn({ ...this.deps, db: tx });
          throw new Crash();
        });
      } catch (error) {
        if (!(error instanceof Crash) && !(error instanceof OrderRuleError)) throw error;
      }
      return undefined;
    };
    const result = await once(action.crash);
    if (action.duplicate && !action.crash) await once(false);
    return result;
  }

  pick(index: number) {
    return this.orders.length ? this.orders[index % this.orders.length] : undefined;
  }

  async proposalOf(index: number, stale: boolean) {
    const order = this.pick(index);
    if (!order) return undefined;
    if (stale) return { orderId: order.id, proposalId: order.firstProposalId };
    const found = await getOrder(testDb.db, order.id);
    return found && { orderId: order.id, proposalId: found.proposal.id };
  }

  async step(a: Action): Promise<void> {
    const later = (minutes: number) => new Date(this.t.getTime() + minutes * MINUTE);
    switch (a.kind) {
      case 'create': {
        const offer = this.offers[a.offer] ?? this.offers[0];
        if (!offer) return;
        const id = a.sameId && this.lastCreateId ? this.lastCreateId : randomUUID();
        this.lastCreateId = id;
        const result = await this.run(a, (d) =>
          createOrder(d, {
            id,
            spaceId: unit.spaceId,
            offerId: offer.offerId,
            slotId: offer.slotId,
            date: DATES[1],
            quantity: a.quantity,
            contact: { email: 'guest@example.test' },
            hold:
              offer.mode === 'on_request'
                ? undefined
                : {
                    expiresAt: later(30),
                    externalRef: offer.mode === 'live' ? `L-${id}` : undefined,
                  },
            responseDeadline: offer.mode === 'on_request' ? later(60) : undefined,
          }),
        );
        if (result?.created) {
          const found = await getOrder(testDb.db, id);
          if (found) this.orders.push({ id, firstProposalId: found.proposal.id });
        }
        return;
      }
      case 'adapterConfirm':
      case 'adapterFail': {
        const ref = await this.proposalOf(a.order, false);
        if (!ref) return;
        const op = a.kind === 'adapterConfirm' ? confirm : fail;
        await this.run(a, (d) => op(d, { ...ref, trigger: 'adapter' }));
        return;
      }
      case 'guestCancel':
      case 'providerCantFulfil': {
        const ref = await this.proposalOf(a.order, false);
        if (!ref) return;
        const trigger = a.kind === 'guestCancel' ? 'guest' : 'provider_link';
        await this.run(a, (d) => cancel(d, { ...ref, trigger }));
        return;
      }
      case 'adminExpire': {
        const ref = await this.proposalOf(a.order, false);
        if (!ref) return;
        await this.run(a, (d) => expire(d, { ...ref, trigger: 'admin' }));
        return;
      }
      case 'providerAccept':
      case 'providerDecline': {
        const ref = await this.proposalOf(a.order, a.stalePage);
        if (!ref) return;
        const op = a.kind === 'providerAccept' ? confirm : decline;
        await this.run(a, (d) => op(d, { ...ref, trigger: 'provider_link' }));
        return;
      }
      case 'providerPropose': {
        const ref = await this.proposalOf(a.order, a.stalePage);
        if (!ref) return;
        await this.run(a, (d) =>
          propose(d, {
            ...ref,
            trigger: 'provider_link',
            proposer: 'provider_time',
            terms: { date: DATES[a.date] ?? DATES[1], quantity: a.quantity },
            cardExpiresAt: later(60),
          }),
        );
        return;
      }
      case 'guestConfirm': {
        const ref = await this.proposalOf(a.order, a.staleCard);
        if (!ref) return;
        await this.run(a, (d) =>
          guestConfirm(d, {
            ...ref,
            trigger: 'guest',
            hold: { expiresAt: later(30) },
            responseDeadline: later(60),
          }),
        );
        return;
      }
      case 'advance':
        this.t = later(a.minutes);
        await this.fireDueTimers(a);
        return;
    }
  }

  /** Plays the pg-boss worker: runs every due timer, in a shuffled order, then marks it done. */
  async fireDueTimers(a: { crash: boolean; duplicate: boolean; shuffle: number }) {
    const ids = this.orders.map((o) => o.id);
    if (ids.length === 0) return 0;
    const { rows } = await testDb.db.execute<{ id: string; data: OrderTimerJobData }>(
      sql`select id, data from pgboss.job where name = ${QUEUES.orderTimer} and state = 'created'
          and start_after <= ${this.t.toISOString()}::timestamptz
          and data->>'orderId' in ${sql`(${sql.join(
            ids.map((id) => sql`${id}`),
            sql`, `,
          )})`}`,
    );
    const due = rows.sort((x, y) => x.id.localeCompare(y.id));
    let seed = a.shuffle;
    for (let i = due.length - 1; i > 0; i--) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      const j = seed % (i + 1);
      [due[i], due[j]] = [due[j] as (typeof due)[number], due[i] as (typeof due)[number]];
    }
    for (const job of due) {
      const result = await this.run(a, (d) => runOrderTimer(d, job.data));
      if (a.crash) continue; // rolled back: the job stays due and runs again later
      if (job.data.operation === 'response_window' && result?.outcome === 'applied') {
        this.windowAlerts.add(job.data.proposalId);
      }
      await testDb.db.execute(sql`update pgboss.job set state = 'completed' where id = ${job.id}`);
    }
    return due.length;
  }

  /** Advances far past every deadline and runs timers, each delivered twice, until none is due. */
  async drain() {
    this.t = new Date(this.t.getTime() + 30 * 24 * 60 * MINUTE);
    for (let i = 0; i < 10; i++) {
      if ((await this.fireDueTimers({ crash: false, duplicate: true, shuffle: i })) === 0) return;
    }
    throw new Error('timers kept firing');
  }

  async check({ drained = false } = {}) {
    const ids = this.orders.map((o) => o.id);
    const offerIds = this.offers.map((o) => o.offerId);
    const all = await testDb.db.select().from(orders).where(inArray(orders.offerId, offerIds));
    // Only committed creates leave an Order, and the model knows each one.
    expect(all.map((o) => o.id).sort()).toEqual([...ids].sort());
    if (ids.length === 0) return;

    const events = await testDb.db
      .select()
      .from(orderEvents)
      .where(inArray(orderEvents.orderId, ids))
      .orderBy(orderEvents.id);
    const proposals = await testDb.db
      .select()
      .from(orderProposals)
      .where(inArray(orderProposals.orderId, ids));
    const holds = await testDb.db
      .select()
      .from(inventoryHolds)
      .where(inArray(inventoryHolds.orderId, ids));
    const { rows: counted } = await testDb.db.execute<{ order_id: string; n: number }>(
      sql`select order_id, n from test_status_changes where order_id in ${sql`(${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )})`}`,
    );

    for (const order of all) {
      const mine = events.filter((e) => e.orderId === order.id);
      // 1. One OrderEvent per status change.
      expect(mine.length, `events of ${order.id}`).toBe(
        counted.find((c) => c.order_id === order.id)?.n,
      );
      expect(mine.at(-1)?.toStatus).toBe(order.status);
      // 3. At most one held hold, and none on a final or awaiting Order.
      const held = holds.filter((h) => h.orderId === order.id && h.state === 'held');
      expect(held.length).toBeLessThanOrEqual(1);
      if (isFinalOrderStatus(order.status) || order.status === 'awaiting_confirmation') {
        expect(held).toHaveLength(0);
      }
      // 5. No action on a stale proposal: every event names the proposal current at that point.
      // A proposal is born with its `propose` event, so replaying the events tracks the current one.
      const version = new Map(proposals.map((p) => [p.id, p.version]));
      let currentId = mine[0]?.proposalId;
      expect(version.get(currentId ?? '')).toBe(1);
      for (const e of mine) {
        if (e.proposalId === currentId) continue;
        expect(version.get(e.proposalId ?? ''), `event ${e.id}`).toBe(
          (version.get(currentId ?? '') ?? 0) + 1,
        );
        expect([e.fromStatus, e.toStatus], `event ${e.id}`).toEqual([
          'pending_provider',
          'awaiting_confirmation',
        ]);
        currentId = e.proposalId;
      }
      expect(currentId).toBe(order.currentProposalId);
      const live = proposals.filter((p) => p.orderId === order.id && p.supersededAt === null);
      expect(live.map((p) => p.id)).toEqual([order.currentProposalId]);
      // 6. Pay-direct keeps Payment status none.
      expect(order.paymentStatus).toBe('none');
      expect(mine.every((e) => e.toPaymentStatus === 'none')).toBe(true);
      // 7. After the drain nothing waits on an expired hold.
      if (drained && order.status === 'confirming') {
        expect(held.every((h) => h.expiresAt > this.t)).toBe(true);
      }
    }

    // 2. Seats conserved.
    for (const offer of this.offers) {
      if (!offer.slotId) continue;
      const [slot] = await testDb.db
        .select()
        .from(allotmentSlots)
        .where(inArray(allotmentSlots.id, [offer.slotId]));
      const taken = holds
        .filter((h) => h.slotId === offer.slotId && h.state !== 'released')
        .reduce((sum, h) => sum + h.quantity, 0);
      expect((slot?.remaining ?? 0) + taken).toBe(this.capacity);
    }

    // 4. Every required notification enqueued exactly once.
    const { rows: notes } = await testDb.db.execute<{ data: Record<string, string> }>(
      sql`select data from pgboss.job where name = ${QUEUES.orderNotify}
          and data->>'orderId' in ${sql`(${sql.join(
            ids.map((id) => sql`${id}`),
            sql`, `,
          )})`}`,
    );
    const actual = notes.map((n) => `${n.data.orderId} ${n.data.proposalId} ${n.data.kind}`);
    const expected: string[] = [];
    for (const e of events) {
      const kind =
        e.toStatus === 'awaiting_confirmation'
          ? e.fromStatus === null
            ? undefined
            : 'order_new_proposal'
          : REQUIRED_NOTIFICATION[e.toStatus];
      if (kind) expected.push(`${e.orderId} ${e.proposalId} ${kind}`);
    }
    for (const proposalId of this.windowAlerts) {
      const p = proposals.find((x) => x.id === proposalId);
      if (p) expected.push(`${p.orderId} ${proposalId} admin_window_missed`);
    }
    expect(actual.sort()).toEqual(expected.sort());
  }
}

async function newWorld(capacity: number): Promise<World> {
  const allotment = await seedOrderableOffer(testDb.db, {
    hostId: unit.hostId,
    availabilityMode: 'allotment',
    capacity,
    startsAt: SLOT_AT,
  });
  const onRequest = await seedOrderableOffer(testDb.db, {
    hostId: unit.hostId,
    availabilityMode: 'on_request',
  });
  const live = await seedOrderableOffer(testDb.db, {
    hostId: unit.hostId,
    availabilityMode: 'live',
  });
  return new World(
    [
      { ...allotment, mode: 'allotment' },
      { ...onRequest, mode: 'on_request' },
      { ...live, mode: 'live' },
    ],
    capacity,
  );
}

async function play(capacity: number, actions: Action[]) {
  const world = await newWorld(capacity);
  for (const action of actions) {
    await world.step(action);
    await world.check();
  }
  await world.drain();
  await world.check({ drained: true });
  return world;
}

const plain = { crash: false, duplicate: false };

describe('Order machine property (pay-direct)', () => {
  it(
    `keeps the invariants over ${RUNS} random interleavings`,
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 4 }),
          fc.array(actionArb, { maxLength: 30 }),
          async (capacity, actions) => {
            await play(capacity, actions);
          },
        ),
        { numRuns: RUNS, seed: SEED, verbose: true },
      );
    },
    RUNS * 4000 + 30_000,
  );

  it('ignores a stale Provider page after a new proposal', async () => {
    const world = await play(2, [
      { kind: 'create', offer: 1, quantity: 2, sameId: false, ...plain },
      { kind: 'providerPropose', order: 0, stalePage: false, date: 2, quantity: 1, ...plain },
      { kind: 'providerAccept', order: 0, stalePage: true, ...plain },
      // The guest accepts the new time, so the Order waits for the Provider again.
      { kind: 'guestConfirm', order: 0, staleCard: false, ...plain },
      { kind: 'providerAccept', order: 0, stalePage: true, ...plain },
      { kind: 'providerDecline', order: 0, stalePage: true, ...plain },
      { kind: 'guestConfirm', order: 0, staleCard: true, ...plain },
    ]);
    const found = await getOrder(testDb.db, world.orders[0]?.id ?? '');
    expect(found?.order.status).toBe('pending_provider');
    expect(found?.proposal.version).toBe(2);
  });

  it('runs a duplicated timer delivery once', async () => {
    const world = await play(2, [
      { kind: 'create', offer: 0, quantity: 2, sameId: false, ...plain },
      { kind: 'advance', minutes: 31, shuffle: 0, crash: false, duplicate: true },
    ]);
    const found = await getOrder(testDb.db, world.orders[0]?.id ?? '');
    expect(found?.order.status).toBe('expired');
  });

  it('leaves nothing after a crash before commit, and the retry creates the Order once', async () => {
    const world = await play(1, [
      { kind: 'create', offer: 0, quantity: 1, sameId: false, crash: true, duplicate: false },
      { kind: 'create', offer: 0, quantity: 1, sameId: true, crash: false, duplicate: true },
      { kind: 'adapterConfirm', order: 0, ...plain },
    ]);
    expect(world.orders).toHaveLength(1);
    const found = await getOrder(testDb.db, world.orders[0]?.id ?? '');
    expect(found?.order.status).toBe('completed');
  });
});
