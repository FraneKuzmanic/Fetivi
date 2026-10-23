import { randomUUID } from 'node:crypto';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import fc from 'fast-check';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { allotmentSlots, offers, providers } from '../db/schema/offers';
import {
  inventoryHolds,
  orderEvents,
  orderProposals,
  orders,
  paymentAttempts,
} from '../db/schema/orders';
import { reconciliationFindings } from '../db/schema/reconciliation';
import { createJobQueue, ensureQueues, type JobQueue, QUEUES } from '../jobs/queue';
import type { OrderPaymentJobData } from '../payments/enqueue';
import { applyStripeEvent, parseStripeEvent } from '../payments/events';
import { PaymentGatewayError } from '../payments/gateway';
import { type PaymentDeps, runPaymentJob } from '../payments/jobs';
import { runReconciliation } from '../payments/reconcile';
import { CHECKOUT_HOLD_MINUTES, type PaymentOperation } from '../payments/vocabulary';
import {
  completeRespond,
  prepareRespond,
  RespondRuleError,
} from '../services/pending/respond-order';
import { createTestDatabase, type TestDatabase } from '../testing';
import {
  type SeededGuestUnit,
  seedGuestUnit,
  seedOrderableOffer,
  seedProvider,
} from '../testing/fixtures';
import { type FakeStripeEvent, type FakeStripeOp, fakePaymentGateway } from '../testing/stripe';
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
import { orderStart, refundFor } from './refunds';
import type { OrderTimerJobData } from './timers';
import { requiredNotifications } from './transitions';
import { isFinalOrderStatus } from './vocabulary';

// Rebuilt from spike S2's property test: random interleavings of guest, Provider, adapter, admin
// and timer events, with crashes before commit and duplicate deliveries, checked after every step
// and after draining every timer. Since 33 a pay-online Offer joins the three pay-direct ones,
// with a fake Stripe: the guest pays, payment jobs call Stripe (a crash rolls back the write
// after the call; a lost response throws after it), and webhooks arrive duplicated, reordered,
// delayed, or never. S2's payment invariants P1-P7 are checked. Since 34 the cancel webhook can be
// lost too, an authorization can lapse, a confirm job can die for good, and the reconciliation
// job runs as a step and in every drain round: it is what closes those gaps. Since 35 a guest
// cancel refunds what the pay-online Offer's rules give at that instant (the cutoff is an hour
// in, so advances cross it), and P8-P9 check the refund amount, the fee share and one refund.
// Since 36 a priced pay-online on-request Offer is paid first and put to the Provider by the
// authorization; a new proposal voids the superseded attempt, and the guest answers it through the
// respond_to_order_update halves (accept opens a new attempt under the next proposal's keys).
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
      elsif old.status is distinct from new.status
         or old.payment_status is distinct from new.payment_status then
        update test_status_changes set n = n + 1 where order_id = new.id;
      end if;
      return new;
    end $$;
    create trigger test_count_status after insert or update of status, payment_status on orders
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
  | { kind: 'guestRespond'; order: number; accept: boolean }
  | { kind: 'advance'; minutes: number; shuffle: number }
  | { kind: 'guestPay'; order: number; late: boolean }
  | { kind: 'deliverWebhooks'; shuffle: number; dropCompletion: boolean; dropCancel: boolean }
  | { kind: 'runPaymentJobs'; shuffle: number; lostResponse: boolean; rounds: number }
  | { kind: 'stripeExpire' }
  | { kind: 'lapse'; order: number }
  | { kind: 'killConfirmJob' }
  | { kind: 'reconcile' };
type Action = Step & { crash: boolean; duplicate: boolean };

// Few Orders per run, so actions pile up on the same Order and reach its later proposals.
const orderIdx = fc.nat(3);
const stepArb: fc.Arbitrary<Step> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.record({
      kind: fc.constant('create' as const),
      // Half the Orders are pay-online (Offer 3, or the on-request Offer 4); the rest spread over
      // the three pay-direct ones.
      offer: fc.oneof(fc.nat(2), fc.constantFrom(3, 4)),
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
      kind: fc.constant('guestRespond' as const),
      order: orderIdx,
      accept: fc.boolean(),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant('advance' as const),
      // Mostly short steps, so a 30-minute checkout often survives to be paid.
      minutes: fc.oneof(fc.integer({ min: 1, max: 10 }), fc.integer({ min: 1, max: 180 })),
      shuffle: fc.nat(),
    }),
  },
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant('guestPay' as const),
      order: orderIdx,
      late: fc.nat(3).map((n) => n === 0),
    }),
  },
  {
    weight: 5,
    arbitrary: fc.record({
      kind: fc.constant('deliverWebhooks' as const),
      shuffle: fc.nat(),
      // A lost completion is closed by reconciliation (or the expire_session job), a lost cancel
      // by reconciliation only (34).
      dropCompletion: fc.nat(4).map((n) => n === 0),
      dropCancel: fc.nat(4).map((n) => n === 0),
    }),
  },
  {
    weight: 6,
    arbitrary: fc.record({
      kind: fc.constant('runPaymentJobs' as const),
      shuffle: fc.nat(),
      lostResponse: fc.nat(3).map((n) => n === 0),
      // The worker keeps polling: jobs the first round enqueues may run in the same step.
      rounds: fc.integer({ min: 1, max: 3 }),
    }),
  },
  fc.record({ kind: fc.constant('stripeExpire' as const) }),
  // Stripe cancels an authorization it held too long.
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('lapse' as const), order: orderIdx }) },
  // pg-boss ran out of retries on every queued confirm job.
  fc.record({ kind: fc.constant('killConfirmJob' as const) }),
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('reconcile' as const) }) },
);
const actionArb: fc.Arbitrary<Action> = fc
  // One step in five crashes before commit, one in four is delivered twice.
  .tuple(stepArb, fc.nat(4), fc.nat(3))
  .map(([step, crash, duplicate]) => ({ ...step, crash: crash === 0, duplicate: duplicate === 0 }));

class Crash extends Error {}

const GUEST_ORIGIN = 'http://guest.test';
const COMPLETION_EVENTS = [
  'checkout.session.completed',
  'payment_intent.amount_capturable_updated',
];
const CANCEL_EVENT = 'payment_intent.canceled';
/** The Stripe call each payment operation makes, for a lost response. */
const STRIPE_OP: Record<PaymentOperation, FakeStripeOp | null> = {
  open: 'create_session',
  confirm: null,
  capture: 'capture',
  void: 'cancel',
  expire_session: 'expire_session',
  refund: 'refund',
};
const RETRY = Symbol('retry');

/** Shuffles in place with a small LCG, so a seed replays the same order. */
function shuffled<T>(items: T[], seed: number): T[] {
  let x = seed;
  for (let i = items.length - 1; i > 0; i--) {
    x = (x * 1103515245 + 12345) % 2147483648;
    const j = x % (i + 1);
    [items[i], items[j]] = [items[j] as T, items[i] as T];
  }
  return items;
}

/** What the guest's cancel refunds now: the policy amount of a capture, else nothing to pass. */
async function policyRefund(d: OrderDeps, orderId: string): Promise<number | undefined> {
  const [row] = await d.db
    .select({ order: orders, proposal: orderProposals, attempt: paymentAttempts })
    .from(orders)
    .innerJoin(orderProposals, eq(orderProposals.id, orders.currentProposalId))
    .innerJoin(paymentAttempts, eq(paymentAttempts.proposalId, orders.currentProposalId))
    .where(eq(orders.id, orderId));
  if (row?.order.paymentStatus !== 'captured') return undefined;
  return refundFor({
    amountMinor: row.attempt.amountMinor,
    startsAt: orderStart(row.proposal, 'Europe/Zagreb'),
    freeCancelHoursBefore: row.order.freeCancelHoursBefore,
    refundPercentAfter: row.order.refundPercentAfter,
    now: d.now(),
  }).amountMinor;
}

type Mode = 'allotment' | 'on_request' | 'live' | 'online' | 'online_request';

/** The attempt of an Order's current proposal, if it has one. */
async function currentAttempt(orderId: string) {
  const [row] = await testDb.db
    .select({ attempt: paymentAttempts })
    .from(paymentAttempts)
    .innerJoin(orders, eq(orders.currentProposalId, paymentAttempts.proposalId))
    .where(eq(orders.id, orderId));
  return row?.attempt;
}

/** One run's world: fresh Offers, a virtual clock and the Orders it created. */
class World {
  t = NOW;
  orders: { id: string; firstProposalId: string; online: boolean }[] = [];
  lastCreateId: string | undefined;
  /** Proposals whose response window alerted the admin (committed runs only). */
  windowAlerts = new Set<string>();
  readonly deps: OrderDeps;
  readonly gateway = fakePaymentGateway({ now: () => this.t });
  /** Webhook events Stripe has sent and not yet seen acknowledged (a crash keeps one here). */
  inbox: FakeStripeEvent[] = [];
  /** P1 and M7 violations, collected where they happen. */
  violations: string[] = [];
  captures = 0;

  constructor(
    readonly offers: { offerId: string; slotId?: string; mode: Mode }[],
    readonly capacity: number,
    /** Off for the control run and for the scenarios that test what 33 did without it. */
    readonly reconcile = true,
  ) {
    this.deps = { db: testDb.db, queue, now: () => this.t };
    // P1: Stripe captures only for the proposal confirmed at that instant.
    this.gateway.onCapture(async (call) => {
      this.captures++;
      const [row] = await testDb.db
        .select({ order: orders, proposalId: paymentAttempts.proposalId })
        .from(paymentAttempts)
        .innerJoin(orders, eq(orders.id, paymentAttempts.orderId))
        .where(eq(paymentAttempts.id, call.attemptId ?? ''));
      if (row?.order.status !== 'confirmed' || row.order.currentProposalId !== row.proposalId) {
        this.violations.push(`P1 capture of ${call.attemptId} while ${row?.order.status}`);
      }
    });
  }

  paymentDeps(d: OrderDeps): PaymentDeps {
    return { ...d, gateway: this.gateway, guestOrigin: GUEST_ORIGIN };
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
        const online = offer.mode === 'online' || offer.mode === 'online_request';
        const hold =
          offer.mode === 'on_request'
            ? undefined
            : {
                expiresAt: later(online ? CHECKOUT_HOLD_MINUTES : 30),
                externalRef: offer.mode === 'live' ? `L-${id}` : undefined,
              };
        const result = await this.run(a, (d) =>
          createOrder(d, {
            id,
            spaceId: unit.spaceId,
            offerId: offer.offerId,
            slotId: offer.slotId,
            date: DATES[1],
            quantity: a.quantity,
            contact: { email: 'guest@example.test' },
            hold,
          }),
        );
        if (result?.created) {
          const found = await getOrder(testDb.db, id);
          if (found) {
            this.orders.push({
              id,
              firstProposalId: found.proposal.id,
              online,
            });
          }
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
      case 'guestCancel': {
        const ref = await this.proposalOf(a.order, false);
        if (!ref) return;
        await this.run(a, async (d) =>
          cancel(d, { ...ref, trigger: 'guest', refundMinor: await policyRefund(d, ref.orderId) }),
        );
        return;
      }
      case 'providerCantFulfil': {
        const ref = await this.proposalOf(a.order, false);
        if (!ref) return;
        await this.run(a, (d) => cancel(d, { ...ref, trigger: 'provider_link' }));
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
          }),
        );
        return;
      }
      case 'guestRespond': {
        // The guest's answer to new terms through the real card halves: prepare, then the tap.
        const order = this.pick(a.order);
        if (!order) return;
        await this.run(a, async (d) => {
          try {
            const { pendingId } = await prepareRespond(
              d,
              { spaceId: unit.spaceId, language: 'en' },
              { orderId: order.id },
            );
            await completeRespond(d, {
              pendingId,
              spaceId: unit.spaceId,
              answer: a.accept ? 'accept' : 'decline',
            });
          } catch (error) {
            if (!(error instanceof RespondRuleError)) throw error;
          }
        });
        return;
      }
      case 'advance':
        this.t = later(a.minutes);
        // Stripe expires its sessions at `expires_at`, like the hold timers.
        this.gateway.expireDue(this.t);
        await this.fireDueTimers(a);
        return;
      case 'guestPay':
        await this.guestPay(a);
        return;
      case 'deliverWebhooks':
        await this.deliverWebhooks(a);
        return;
      case 'runPaymentJobs':
        for (let round = 0; round < a.rounds; round++) {
          const ran = await this.runPaymentJobs({
            ...a,
            shuffle: a.shuffle + round,
            lostResponse: a.lostResponse && round === 0,
          });
          if (ran === 0) return;
        }
        return;
      case 'stripeExpire':
        this.gateway.expireDue(this.t);
        return;
      case 'lapse':
        await this.lapse(a.order);
        return;
      case 'killConfirmJob':
        await this.killConfirmJobs();
        return;
      case 'reconcile':
        if (this.reconcile) await this.run(a, (d) => this.reconcileOnce(d));
        return;
    }
  }

  async attemptIds() {
    const ids = this.orders.filter((o) => o.online).map((o) => o.id);
    if (ids.length === 0) return [];
    const rows = await testDb.db
      .select({ id: paymentAttempts.id })
      .from(paymentAttempts)
      .where(inArray(paymentAttempts.orderId, ids));
    return rows.map((r) => r.id);
  }

  /** Stripe lapses an Order's uncaptured authorization (7 days in real life). */
  async lapse(index: number) {
    const online = this.orders.filter((o) => o.online);
    const order = online.length ? online[index % online.length] : undefined;
    if (!order) return;
    const attempt = await currentAttempt(order.id);
    const session = this.gateway.state().sessions.find((x) => x.clientReferenceId === attempt?.id);
    if (session?.paymentIntentId) this.gateway.lapse(session.paymentIntentId);
  }

  /** Every queued confirm job of this world fails for good, as when pg-boss exhausts retries. */
  async killConfirmJobs() {
    const ids = await this.attemptIds();
    if (ids.length === 0) return;
    await testDb.db.execute(
      sql`update pgboss.job set state = 'failed' where name = ${QUEUES.orderPayment}
          and state = 'created' and data->>'operation' = 'confirm'
          and data->>'attemptId' in ${sql`(${sql.join(
            ids.map((id) => sql`${id}`),
            sql`, `,
          )})`}`,
    );
  }

  /** One reconciliation run; returns how many findings it put right through the machine. */
  async reconcileOnce(d: OrderDeps) {
    const { runId } = await runReconciliation(this.paymentDeps(d), { trigger: 'schedule' });
    const applied = await d.db
      .select({ id: reconciliationFindings.id })
      .from(reconciliationFindings)
      .where(
        and(
          eq(reconciliationFindings.runId, runId),
          like(reconciliationFindings.action, '%: applied'),
        ),
      );
    return applied.length;
  }

  /**
   * The guest completes the hosted Checkout of an Order's open session. `late`: at the last
   * second, so the completion arrives after the hold expired (S2 M3).
   */
  async guestPay(a: Action & { kind: 'guestPay' }) {
    const online = this.orders.filter((o) => o.online);
    const order = online.length ? online[a.order % online.length] : undefined;
    if (!order) return;
    const attempt = await currentAttempt(order.id);
    this.gateway.expireDue(this.t);
    const session = this.gateway
      .state()
      .sessions.find((s) => s.clientReferenceId === attempt?.id && s.status === 'open');
    if (!session) return;
    this.gateway.pay(session.id);
    if (a.late) {
      this.t = new Date(session.expiresAt.getTime() + MINUTE);
      await this.fireDueTimers({ ...a, shuffle: 0 });
    }
  }

  /** Stripe's webhook deliveries: pending events in a shuffled order; a crash redelivers later. */
  async deliverWebhooks(a: Action & { kind: 'deliverWebhooks' }) {
    this.inbox.push(...this.gateway.takeEvents());
    const batch = shuffled([...this.inbox], a.shuffle);
    let delivered = 0;
    for (const event of batch) {
      const dropped =
        (a.dropCompletion && COMPLETION_EVENTS.includes(event.type)) ||
        (a.dropCancel && event.type === CANCEL_EVENT);
      if (dropped) {
        this.inbox = this.inbox.filter((e) => e !== event);
        continue;
      }
      await this.run(a, (d) => applyStripeEvent(d, parseStripeEvent(event)));
      if (a.crash) continue; // answered 500: Stripe sends it again
      this.inbox = this.inbox.filter((e) => e !== event);
      delivered++;
    }
    return delivered;
  }

  /** Plays the worker for order-payment: every queued job, shuffled; a failed one stays queued. */
  async runPaymentJobs(a: Action & { kind: 'runPaymentJobs' }) {
    const attempts = await this.attemptIds();
    if (attempts.length === 0) return 0;
    const { rows } = await testDb.db.execute<{ id: string; data: OrderPaymentJobData }>(
      sql`select id, data from pgboss.job where name = ${QUEUES.orderPayment} and state = 'created'
          and data->>'attemptId' in ${sql`(${sql.join(
            attempts.map((id) => sql`${id}`),
            sql`, `,
          )})`}`,
    );
    const due = shuffled(
      rows.sort((x, y) => x.id.localeCompare(y.id)),
      a.shuffle,
    );
    let lost = a.lostResponse;
    for (const [index, job] of due.entries()) {
      // A payment job commits its own writes around the Stripe call, so rolling it back whole
      // would undo a write committed before the call. A crash is modelled where it can happen:
      // before the job runs (it stays queued), or after Stripe answered (a lost response).
      if (a.crash && index === 0) continue;
      const op = STRIPE_OP[job.data.operation];
      if (lost && op) {
        this.gateway.failNext(op, 'response-lost');
        lost = false;
      }
      const result = await this.run({ crash: false, duplicate: a.duplicate }, async (d) => {
        try {
          return await runPaymentJob(this.paymentDeps(d), job.data);
        } catch (error) {
          if (!(error instanceof PaymentGatewayError)) throw error;
          // M7: a retry must send identical parameters under its key.
          if (error.code === 'idempotency-mismatch') this.violations.push(`M7 ${error.message}`);
          return RETRY;
        }
      });
      if (result === RETRY) continue; // pg-boss runs it again
      await testDb.db.execute(sql`update pgboss.job set state = 'completed' where id = ${job.id}`);
    }
    return due.length;
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

  /**
   * Lets the workers settle what is in flight at the current time, then advances far past every
   * deadline and runs timers, payment jobs, webhooks and reconciliation, each delivered twice and
   * none lost, until nothing is left.
   */
  async drain() {
    for (let i = 0; i < 10; i++) {
      if ((await this.settle(i)) === 0) break;
    }
    for (let i = 0; i < 20; i++) {
      this.t = new Date(this.t.getTime() + 30 * 24 * 60 * MINUTE);
      if ((await this.settle(i)) === 0) return;
    }
    throw new Error('timers, payment jobs or webhooks kept coming');
  }

  /** One round of every worker at the current time; returns how much it did or left behind. */
  async settle(shuffle: number) {
    const twice = { crash: false, duplicate: true, shuffle };
    this.gateway.expireDue(this.t);
    const timers = await this.fireDueTimers(twice);
    const jobs = await this.runPaymentJobs({
      kind: 'runPaymentJobs',
      ...twice,
      rounds: 1,
      lostResponse: false,
    });
    const events = await this.deliverWebhooks({
      kind: 'deliverWebhooks',
      ...twice,
      dropCompletion: false,
      dropCancel: false,
    });
    const reconciled = this.reconcile ? await this.reconcileOnce(this.deps) : 0;
    return timers + jobs + events + reconciled + this.inbox.length;
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

    const attempts = await testDb.db
      .select()
      .from(paymentAttempts)
      .where(inArray(paymentAttempts.orderId, ids));
    const stripe = this.gateway.state();
    const { rows: voidJobs } = await testDb.db.execute<{ attempt_id: string }>(
      sql`select data->>'attemptId' as attempt_id from pgboss.job
          where name = ${QUEUES.orderPayment} and data->>'operation' = 'void'`,
    );
    const voids = new Set(voidJobs.map((j) => j.attempt_id));

    for (const order of all) {
      const mine = events.filter((e) => e.orderId === order.id);
      // 1. One OrderEvent per change of Order or Payment status; an admin flag writes one more,
      // with no change.
      const changes = mine.filter(
        (e) =>
          e.fromStatus === null ||
          e.fromStatus !== e.toStatus ||
          e.fromPaymentStatus !== e.toPaymentStatus,
      );
      expect(changes.length, `events of ${order.id}`).toBe(
        counted.find((c) => c.order_id === order.id)?.n,
      );
      expect(mine.at(-1)?.toStatus).toBe(order.status);
      expect(mine.at(-1)?.toPaymentStatus).toBe(order.paymentStatus);
      // 3. At most one held hold, and none on a final, awaiting or Provider-pending Order: on
      // request holds nothing while the Provider decides (36).
      const held = holds.filter((h) => h.orderId === order.id && h.state === 'held');
      expect(held.length).toBeLessThanOrEqual(1);
      if (
        isFinalOrderStatus(order.status) ||
        order.status === 'awaiting_confirmation' ||
        order.status === 'pending_provider'
      ) {
        expect(held, `held hold on ${order.status} ${order.id}`).toHaveLength(0);
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
        // 8. A new proposal starts with Payment status none; a superseded authorization is voided.
        expect(e.toPaymentStatus, `event ${e.id}`).toBe('none');
        if (e.fromPaymentStatus === 'authorized') {
          const old = attempts.find((x) => x.proposalId === currentId);
          expect(old && voids.has(old.id), `void of ${old?.id}`).toBe(true);
        }
        currentId = e.proposalId;
      }
      expect(currentId).toBe(order.currentProposalId);
      const live = proposals.filter((p) => p.orderId === order.id && p.supersededAt === null);
      expect(live.map((p) => p.id)).toEqual([order.currentProposalId]);
      if (order.paymentMode === 'direct') {
        // 6. Pay-direct keeps Payment status none.
        expect(order.paymentStatus).toBe('none');
        expect(mine.every((e) => e.toPaymentStatus === 'none')).toBe(true);
      } else {
        this.checkPayment(order, attempts, stripe, drained);
      }
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
    // The admin's payment flag is enqueued by the payment transition that raised it, not by a
    // status change: it is checked against the flagging events below.
    const flags = notes.filter((n) => n.data.kind === 'admin_payment_attention');
    const actual = notes
      .filter((n) => n.data.kind !== 'admin_payment_attention')
      .map((n) => `${n.data.orderId} ${n.data.proposalId} ${n.data.kind}`);
    const expected: string[] = [];
    const modeOf = new Map(all.map((o) => [o.id, o.paymentMode]));
    for (const e of events) {
      if (e.fromStatus !== null && e.fromStatus === e.toStatus) continue;
      const mode = modeOf.get(e.orderId) ?? 'direct';
      for (const kind of requiredNotifications(e.fromStatus, e.toStatus, e.trigger, mode)) {
        expected.push(`${e.orderId} ${e.proposalId} ${kind}`);
      }
    }
    for (const flag of flags) {
      // Every flag names the OrderEvent of that Order whose note explains it.
      expect(modeOf.get(flag.data.orderId ?? '')).toBe('online');
      const named = events.find((e) => String(e.id) === String(flag.data.eventId));
      expect(named?.orderId).toBe(flag.data.orderId);
      expect(named?.note).toBeTruthy();
    }
    const flagged = flags.map((f) => f.data.orderId);
    for (const id of this.needsFlag) expect(flagged, `flag for ${id}`).toContain(id);
    this.needsFlag = [];
    // P1 and M7, recorded where they happen.
    expect(this.violations).toEqual([]);
    for (const proposalId of this.windowAlerts) {
      const p = proposals.find((x) => x.id === proposalId);
      if (p) expected.push(`${p.orderId} ${proposalId} admin_window_missed`);
    }
    expect(actual.sort()).toEqual(expected.sort());
  }

  /** Confirmed pay-online Orders left uncaptured: each must have an admin flag (P5). */
  needsFlag: string[] = [];

  /** S2's payment invariants for one pay-online Order. */
  checkPayment(order: OrderRow, all: AttemptRow[], stripe: StripeState, drained: boolean) {
    const attempts = all.filter((x) => x.orderId === order.id);
    // At most one attempt per proposal (36: a new proposal gets its own when the guest accepts).
    expect(new Set(attempts.map((x) => x.proposalId)).size).toBe(attempts.length);
    for (const old of attempts.filter((x) => x.proposalId !== order.currentProposalId)) {
      this.checkSuperseded(old, stripe, drained);
    }
    const attempt = attempts.find((x) => x.proposalId === order.currentProposalId);
    // No attempt yet (a request-kind or new proposal before the guest's yes): nothing is held.
    if (!attempt) {
      expect(order.paymentStatus, `payment of ${order.id}`).toBe('none');
      return;
    }
    // P7: every Stripe event id is processed at most once.
    expect(new Set(attempt.processedEventIds).size).toBe(attempt.processedEventIds.length);
    // P2: money is captured only for a confirmed Order (a capture that lost a race to a cancel
    // moves on to the refund in the same transaction), or a cancelled one whose policy refund
    // was 0: that money is the Provider's.
    const keptByPolicy = order.status === 'cancelled' && attempt.refundAmountMinor === 0;
    if (order.paymentStatus === 'captured' && !keptByPolicy) {
      expect(['confirmed', 'completed'], `captured ${order.id}`).toContain(order.status);
    }
    if (!drained) return;
    const sessions = stripe.sessions.filter((x) => x.clientReferenceId === attempt.id);
    const session = sessions[0];
    const intent = stripe.intents.find((i) => i.id === session?.paymentIntentId);
    const refunds = stripe.refunds.filter((r) => r.paymentIntentId === intent?.id);
    const refund = refunds[0];
    // P9: at most one Stripe refund per attempt.
    expect(refunds.length, `refunds of ${attempt.id}`).toBeLessThanOrEqual(1);
    if (refund && intent) {
      // P8: Stripe refunded the amount decided on the attempt, with the fee in proportion.
      expect(refund.amountMinor).toBe(attempt.refundAmountMinor);
      expect(refund.applicationFeeRefundedMinor).toBe(
        Math.floor(((intent.applicationFeeAmount ?? 0) * refund.amountMinor) / intent.amountMinor),
      );
    }
    // P4: Fetivi's attempt state equals Stripe's; every session belongs to an attempt.
    expect(sessions.length).toBeLessThanOrEqual(1);
    expect(attempt.sessionId ?? null).toBe(session?.id ?? null);
    expect(attempt.sessionStatus ?? null).toBe(session?.status ?? null);
    expect(attempt.paymentIntentId ?? null).toBe(intent?.id ?? null);
    expect(attempt.intentStatus ?? null).toBe(intent?.status ?? null);
    expect(attempt.refundStatus ?? null).toBe(refund?.status ?? null);
    // P6: no session is left open.
    expect(session?.status).not.toBe('open');
    if (isFinalOrderStatus(order.status) && order.status !== 'completed' && !keptByPolicy) {
      // P3: terminal Orders hold no money, except what a 0 % policy leaves with the Provider.
      expect(['none', 'voided', 'refunded'], `payment of ${order.id}`).toContain(
        order.paymentStatus,
      );
      expect(intent?.status).not.toBe('requires_capture');
      if (intent?.status === 'succeeded') expect(refund?.status).toBe('succeeded');
    }
    if (order.status === 'confirmed' || order.status === 'completed') {
      // P5: a confirmed pay-online Order ends captured, or the admin was told.
      if (order.paymentStatus !== 'captured') this.needsFlag.push(order.id);
      else expect(intent?.applicationFeeAmount).toBe(attempt.applicationFeeMinor);
    }
  }

  /** A superseded proposal's attempt: never captured, and after the drain it holds no money. */
  checkSuperseded(attempt: AttemptRow, stripe: StripeState, drained: boolean) {
    expect(new Set(attempt.processedEventIds).size).toBe(attempt.processedEventIds.length);
    if (!drained) return;
    const session = stripe.sessions.find((x) => x.clientReferenceId === attempt.id);
    const intent = stripe.intents.find((i) => i.id === session?.paymentIntentId);
    expect(session?.status, `session of superseded ${attempt.id}`).not.toBe('open');
    expect(['requires_capture', 'succeeded'], `intent of superseded ${attempt.id}`).not.toContain(
      intent?.status,
    );
  }
}

type OrderRow = typeof orders.$inferSelect;
type AttemptRow = typeof paymentAttempts.$inferSelect;
type StripeState = ReturnType<World['gateway']['state']>;

interface WorldOptions {
  reconcile?: boolean;
  /** The pay-online Offer's percentage after the cutoff; unset keeps the seeded rules. */
  refundPercentAfter?: number;
}

async function newWorld(capacity: number, options: WorldOptions = {}): Promise<World> {
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
  // Pay-online needs a Provider that can take cards.
  const provider = await seedProvider(testDb.db, { commissionBp: 1250 });
  await testDb.db
    .update(providers)
    .set({ stripeAccountId: `acct_prop_${provider.id.slice(0, 8)}`, stripeCardPayments: 'active' })
    .where(eq(providers.id, provider.id));
  const online = await seedOrderableOffer(testDb.db, {
    providerId: provider.id,
    availabilityMode: 'allotment',
    paymentMode: 'online',
    priceMinor: 2500,
    capacity,
    startsAt: SLOT_AT,
  });
  const onlineRequest = await seedOrderableOffer(testDb.db, {
    providerId: provider.id,
    availabilityMode: 'on_request',
    paymentMode: 'online',
    priceMinor: 4000,
  });
  if (options.refundPercentAfter !== undefined) {
    // The cutoff an hour after NOW: 68 h before the 69 h away start.
    await testDb.db
      .update(offers)
      .set({ freeCancelHoursBefore: 68, refundPercentAfter: options.refundPercentAfter })
      .where(eq(offers.id, online.offerId));
  }
  return new World(
    [
      { ...allotment, mode: 'allotment' },
      { ...onRequest, mode: 'on_request' },
      { ...live, mode: 'live' },
      { ...online, mode: 'online' },
      { ...onlineRequest, mode: 'online_request' },
    ],
    capacity,
    options.reconcile,
  );
}

async function play(capacity: number, actions: Action[], options: WorldOptions = {}) {
  const world = await newWorld(capacity, options);
  for (const action of actions) {
    await world.step(action);
    await world.check();
  }
  await world.drain();
  await world.check({ drained: true });
  return world;
}

const plain = { crash: false, duplicate: false };

describe('Order machine property', () => {
  it(
    `keeps the invariants over ${RUNS} random interleavings`,
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 4 }),
          fc.array(actionArb, { maxLength: 30, size: 'medium' }),
          fc.constantFrom(0, 40, 100),
          async (capacity, actions, refundPercentAfter) => {
            await play(capacity, actions, { refundPercentAfter });
          },
        ),
        { numRuns: RUNS, seed: SEED, verbose: true },
      );
    },
    RUNS * 8000 + 30_000,
  );

  it('ignores a stale Provider page after a new proposal', async () => {
    const world = await play(2, [
      { kind: 'create', offer: 1, quantity: 2, sameId: false, ...plain },
      { kind: 'providerPropose', order: 0, stalePage: false, date: 2, quantity: 1, ...plain },
      { kind: 'providerAccept', order: 0, stalePage: true, ...plain },
      // The guest accepts the Provider's own new time: no second ask, the hold is placed.
      { kind: 'guestConfirm', order: 0, staleCard: false, ...plain },
      { kind: 'providerAccept', order: 0, stalePage: true, ...plain },
      { kind: 'providerDecline', order: 0, stalePage: true, ...plain },
      { kind: 'guestConfirm', order: 0, staleCard: true, ...plain },
      { kind: 'adapterConfirm', order: 0, ...plain },
    ]);
    // None of the stale taps landed: the new terms were confirmed and the day passed.
    const found = await getOrder(testDb.db, world.orders[0]?.id ?? '');
    expect(found?.order.status).toBe('completed');
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

// Pay-online scenarios: each one kills one of S2's deliberate bugs (M1-M7), on top of the random
// interleavings above.
const buy: Action = { kind: 'create', offer: 3, quantity: 2, sameId: false, ...plain };
const jobs = (extra: Partial<Action & { kind: 'runPaymentJobs' }> = {}): Action => ({
  kind: 'runPaymentJobs',
  shuffle: 0,
  rounds: 1,
  lostResponse: false,
  ...plain,
  ...extra,
});
const hooks = (extra: Partial<Action & { kind: 'deliverWebhooks' }> = {}): Action => ({
  kind: 'deliverWebhooks',
  shuffle: 0,
  dropCompletion: false,
  dropCancel: false,
  ...plain,
  ...extra,
});
const pay = (late = false): Action => ({ kind: 'guestPay', order: 0, late, ...plain });
const wait = (minutes: number): Action => ({ kind: 'advance', minutes, shuffle: 0, ...plain });
const reconcile: Action = { kind: 'reconcile', ...plain };
const killConfirmJob: Action = { kind: 'killConfirmJob', ...plain };
const lapse: Action = { kind: 'lapse', order: 0, ...plain };

async function steps(world: World, actions: Action[]) {
  for (const action of actions) {
    await world.step(action);
    await world.check();
  }
}

async function finish(world: World) {
  await world.drain();
  await world.check({ drained: true });
}

async function stateOf(world: World) {
  const found = await getOrder(testDb.db, world.orders[0]?.id ?? '');
  const [attempt] = await testDb.db
    .select()
    .from(paymentAttempts)
    .where(eq(paymentAttempts.orderId, world.orders[0]?.id ?? ''));
  return { order: found?.order, attempt };
}

const callsOf = (world: World, op: FakeStripeOp) => world.gateway.calls.filter((c) => c.op === op);

describe('Order machine property (pay-online, S2 mutants)', () => {
  it('M1, M2: captures only once confirmed, once per duplicated or reordered event', async () => {
    const world = await newWorld(2);
    await steps(world, [
      buy,
      jobs(),
      pay(),
      hooks({ shuffle: 7, duplicate: true }),
      jobs(), // confirm
      jobs(), // capture
    ]);
    const { order, attempt } = await stateOf(world);
    expect([order?.status, order?.paymentStatus]).toEqual(['confirmed', 'captured']);
    expect(world.captures).toBe(1);
    // 2 × 25.00 at 12.5 %.
    expect(world.gateway.state().intents[0]?.applicationFeeAmount).toBe(625);
    expect(attempt?.processedEventIds).toHaveLength(2);
    await finish(world);
  });

  it('a crashed webhook is redelivered and applied once', async () => {
    const world = await newWorld(2);
    await steps(world, [buy, jobs(), pay(), hooks({ crash: true })]);
    expect((await stateOf(world)).order?.paymentStatus).toBe('none');
    await steps(world, [hooks()]);
    expect((await stateOf(world)).order?.paymentStatus).toBe('authorized');
    await finish(world);
  });

  it('M3: a checkout completed after the hold expired is voided', async () => {
    const world = await newWorld(2);
    await steps(world, [buy, jobs(), pay(true)]);
    expect((await stateOf(world)).order?.status).toBe('expired');
    await steps(world, [hooks(), jobs(), hooks()]);
    const { order } = await stateOf(world);
    expect([order?.status, order?.paymentStatus]).toEqual(['expired', 'voided']);
    const { rows } = await testDb.db.execute<{ kind: string }>(
      sql`select data->>'kind' as kind from pgboss.job where name = ${QUEUES.orderNotify}
          and data->>'orderId' = ${order?.id ?? ''}`,
    );
    expect(rows.map((r) => r.kind)).toContain('order_checkout_expired');
    expect(rows.map((r) => r.kind)).not.toContain('order_expired');
    await finish(world);
  });

  it('M4: a void that meets a captured intent refunds it, fee included', async () => {
    const world = await newWorld(2);
    await steps(world, [
      buy,
      jobs(),
      pay(),
      hooks(),
      jobs(), // confirm
      jobs({ lostResponse: true }), // Stripe captured; the answer never came
      { kind: 'providerCantFulfil', order: 0, ...plain },
      jobs(), // capture is stale now; the void finds the intent captured
    ]);
    expect((await stateOf(world)).order?.status).toBe('cancelled');
    await finish(world);
    const { order } = await stateOf(world);
    expect(order?.paymentStatus).toBe('refunded');
    expect(world.gateway.state().refunds).toEqual([
      expect.objectContaining({ status: 'succeeded', refundApplicationFee: true }),
    ]);
  });

  it('capture re-checks confirmed: a cancel before the capture job leaves nothing captured', async () => {
    const world = await newWorld(2);
    await steps(world, [
      buy,
      jobs(),
      pay(),
      hooks(),
      jobs(), // confirm
      { kind: 'providerCantFulfil', order: 0, ...plain },
      jobs(),
    ]);
    expect(callsOf(world, 'capture')).toHaveLength(0);
    const { order } = await stateOf(world);
    expect([order?.status, order?.paymentStatus]).toEqual(['cancelled', 'voided']);
    await finish(world);
  });

  it('M6: a restamped checkout makes the old hold timer stale', async () => {
    const world = await newWorld(2);
    await steps(world, [buy, wait(2), jobs(), jobs()]);
    const { attempt } = await stateOf(world);
    const restamped = new Date(NOW.getTime() + (2 + CHECKOUT_HOLD_MINUTES) * MINUTE);
    expect(attempt?.expiresAt).toEqual(restamped);
    const [hold] = await testDb.db
      .select()
      .from(inventoryHolds)
      .where(eq(inventoryHolds.orderId, world.orders[0]?.id ?? ''));
    expect(hold?.expiresAt).toEqual(restamped);
    expect(world.gateway.state().sessions[0]?.expiresAt).toEqual(restamped);
    // The first hold timer (30 minutes after create) comes due and changes nothing.
    await steps(world, [wait(29)]);
    expect((await stateOf(world)).order?.status).toBe('confirming');
    await steps(world, [wait(2), hooks()]);
    expect((await stateOf(world)).order?.status).toBe('expired');
    await finish(world);
  });

  it('M7: the retry after a lost create response sends identical parameters', async () => {
    const world = await newWorld(2);
    await steps(world, [buy, jobs({ lostResponse: true }), jobs()]);
    const creates = callsOf(world, 'create_session');
    expect(creates).toHaveLength(2);
    expect(creates[1]?.idempotencyKey).toBe(creates[0]?.idempotencyKey);
    expect(JSON.stringify(creates[1]?.params)).toBe(JSON.stringify(creates[0]?.params));
    expect(world.gateway.state().sessions).toHaveLength(1);
    expect((await stateOf(world)).attempt?.sessionId).toBe(world.gateway.state().sessions[0]?.id);
    await finish(world);
  });

  it('learns the session from its webhook when the create response was lost', async () => {
    // Found by the random run: the guest paid late a session Fetivi never heard back about.
    const world = await newWorld(1);
    await steps(world, [
      { ...buy, quantity: 1 },
      jobs({ lostResponse: true }),
      pay(true),
      hooks({ duplicate: true }),
    ]);
    const { order, attempt } = await stateOf(world);
    expect(order?.status).toBe('expired');
    expect(attempt?.sessionId).toBe(world.gateway.state().sessions[0]?.id);
    await finish(world);
    expect((await stateOf(world)).order?.paymentStatus).toBe('voided');
  });

  it('a lost completion webhook is closed by the expire_session job', async () => {
    // Without reconciliation, which would find the completion first (34).
    const world = await newWorld(2, { reconcile: false });
    await steps(world, [buy, jobs(), pay(), hooks({ dropCompletion: true })]);
    expect((await stateOf(world)).order?.paymentStatus).toBe('none');
    await finish(world);
    const { order } = await stateOf(world);
    expect([order?.status, order?.paymentStatus]).toEqual(['expired', 'voided']);
    expect(callsOf(world, 'retrieve_session').length).toBeGreaterThan(0);
  });
});

// On request (36): a priced pay-online Offer is paid before the Provider is asked, and new terms
// void the paid attempt and open the next one under the new proposal's keys.
describe('Order machine property (on request, pay first)', () => {
  const ask: Action = { kind: 'create', offer: 4, quantity: 2, sameId: false, ...plain };
  const propose: Action = {
    kind: 'providerPropose',
    order: 0,
    stalePage: false,
    date: 2,
    quantity: 2,
    ...plain,
  };
  const respond = (accept: boolean): Action => ({
    kind: 'guestRespond',
    order: 0,
    accept,
    ...plain,
  });

  it('asks the Provider only once paid, holding nothing while it waits', async () => {
    const world = await newWorld(2);
    await steps(world, [ask, jobs()]);
    expect((await stateOf(world)).order?.status).toBe('confirming');
    await steps(world, [pay(), hooks()]);
    const { order } = await stateOf(world);
    expect([order?.status, order?.paymentStatus]).toEqual(['pending_provider', 'authorized']);
    await steps(world, [{ kind: 'providerAccept', order: 0, stalePage: false, ...plain }, jobs()]);
    expect((await stateOf(world)).order?.paymentStatus).toBe('captured');
    await finish(world);
  });

  it('new terms void the paid attempt; the accepted ones are paid on a second attempt', async () => {
    const world = await newWorld(2);
    await steps(world, [ask, jobs(), pay(), hooks(), propose]);
    let { order } = await stateOf(world);
    expect([order?.status, order?.paymentStatus]).toEqual(['awaiting_confirmation', 'none']);
    await steps(world, [jobs(), hooks(), respond(true), jobs(), pay(), hooks(), jobs(), jobs()]);
    ({ order } = await stateOf(world));
    expect([order?.status, order?.paymentStatus]).toEqual(['confirmed', 'captured']);
    const attempts = await testDb.db
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.orderId, order?.id ?? ''));
    expect(attempts.map((a) => a.proposalVersion).sort()).toEqual([1, 2]);
    expect(attempts.find((a) => a.proposalVersion === 1)?.intentStatus).toBe('canceled');
    await finish(world);
  });

  it('declining the new terms cancels with nothing held', async () => {
    const world = await newWorld(2);
    await steps(world, [ask, jobs(), pay(), hooks(), propose, respond(false)]);
    expect((await stateOf(world)).order?.status).toBe('cancelled');
    await finish(world);
  });
});

// Reconciliation (34): what a lost webhook, a lapse or a dead job leaves behind is read back from
// Stripe and the holds, and fed through the machine.
const LAPSE: Action[] = [
  buy,
  jobs(),
  pay(),
  hooks(),
  killConfirmJob,
  lapse,
  hooks({ dropCancel: true }),
  reconcile,
];

async function flagsOf(orderId: string) {
  const { rows } = await testDb.db.execute<{ kind: string }>(
    sql`select data->>'kind' as kind from pgboss.job where name = ${QUEUES.orderNotify}
        and data->>'orderId' = ${orderId} and data->>'kind' = 'admin_payment_attention'`,
  );
  return rows.length;
}

describe('Order machine property (reconciliation)', () => {
  it('a lost completion webhook is closed by reconciliation while the hold is live', async () => {
    const world = await newWorld(2);
    await steps(world, [
      buy,
      jobs(),
      pay(),
      hooks({ dropCompletion: true }),
      reconcile,
      jobs(),
      jobs(),
    ]);
    const { order } = await stateOf(world);
    expect([order?.status, order?.paymentStatus]).toEqual(['confirmed', 'captured']);
    expect(callsOf(world, 'expire_session')).toHaveLength(0);
    await finish(world);
  });

  it('a lapse while confirming with the cancel webhook lost is reconciled', async () => {
    const world = await newWorld(2);
    await steps(world, LAPSE);
    const { order, attempt } = await stateOf(world);
    expect([order?.status, order?.paymentStatus]).toEqual(['failed', 'voided']);
    expect(attempt?.intentStatus).toBe('canceled');
    const [hold] = await testDb.db
      .select()
      .from(inventoryHolds)
      .where(eq(inventoryHolds.orderId, order?.id ?? ''));
    expect(hold?.state).toBe('released');
    expect(await flagsOf(order?.id ?? '')).toBe(1);
    await finish(world);
  });

  it('a dead confirm job without a lapse: after the confirm grace the Order fails and is voided', async () => {
    const world = await newWorld(2);
    await steps(world, [buy, jobs(), pay(), hooks(), killConfirmJob]);
    expect((await stateOf(world)).order?.status).toBe('confirming');
    await finish(world);
    const { order } = await stateOf(world);
    expect([order?.status, order?.paymentStatus]).toEqual(['failed', 'voided']);
    expect(await flagsOf(order?.id ?? '')).toBe(1);
  });

  it('a pay-direct confirming Order whose hold timer was lost is expired by reconciliation', async () => {
    const world = await newWorld(2);
    await steps(world, [{ ...buy, offer: 0 }]);
    const id = world.orders[0]?.id ?? '';
    await testDb.db.execute(
      sql`delete from pgboss.job where name = ${QUEUES.orderTimer} and data->>'orderId' = ${id}`,
    );
    await steps(world, [wait(31)]);
    expect((await stateOf(world)).order?.status).toBe('confirming');
    await steps(world, [wait(2), reconcile]);
    expect((await stateOf(world)).order?.status).toBe('expired');
    await finish(world);
  });

  it('a cancel delivered before the completion fails the Order instead of confirming it', async () => {
    // Found by the 500-run: the lapse's cancel reached Fetivi before the completion, and the
    // completion then authorized an intent Stripe had already cancelled.
    const world = await newWorld(1);
    await steps(world, [
      { ...buy, quantity: 1 },
      jobs({ lostResponse: true }),
      { ...pay(true), crash: true },
      lapse,
      hooks({ shuffle: 1312972234, duplicate: true }),
    ]);
    const { order } = await stateOf(world);
    expect([order?.status, order?.paymentStatus]).toEqual(['failed', 'voided']);
    expect(await flagsOf(order?.id ?? '')).toBe(1);
    await finish(world);
  });

  it('control: without reconciliation the lapse scenario fails', async () => {
    // P4 (Fetivi still mirrors requires_capture) or invariant 7 (a held hold past expiry).
    await expect(play(2, LAPSE, { reconcile: false })).rejects.toMatchObject({
      name: 'AssertionError',
    });
    await expect(play(2, LAPSE)).resolves.toBeDefined();
  });
});
