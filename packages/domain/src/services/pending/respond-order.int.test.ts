import { eq, sql } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { providers } from '../../db/schema/offers';
import { orderEvents, orders, paymentAttempts } from '../../db/schema/orders';
import { createJobQueue, ensureQueues, type JobQueue, QUEUES } from '../../jobs/queue';
import {
  createOrder,
  getOrder,
  type OrderDeps,
  propose,
  runOrderTimer,
} from '../../orders/machine';
import { providerPropose } from '../../orders/provider-answers';
import type { OrderPaymentJobData } from '../../payments/enqueue';
import { applyStripeEvent, parseStripeEvent } from '../../payments/events';
import { type PaymentDeps, runPaymentJob } from '../../payments/jobs';
import { stripeIdempotencyKey } from '../../payments/keys';
import { CHECKOUT_HOLD_MINUTES, type PaymentOperation } from '../../payments/vocabulary';
import {
  createTestDatabase,
  fakePaymentGateway,
  type SeededGuestUnit,
  seedGuestUnit,
  seedOrderableOffer,
  seedProvider,
  type TestDatabase,
} from '../../testing';
import { prepareCancel } from './cancel-order';
import { completeRespond, prepareRespond, RespondRuleError } from './respond-order';

// The respond_to_order_update halves (36): the guest accepts or declines terms the Provider
// proposed, bound to the proposal the card showed.

let testDb: TestDatabase;
let boss: PgBoss;
let queue: JobQueue;
let guest: SeededGuestUnit;

const NOW = new Date('2027-05-01T10:00:00Z');
// seedGuestUnit: check-in 2027-05-03, three nights, checkout 2027-05-06.
const DAY = '2027-05-04';
const HOLD_UNTIL = new Date(NOW.getTime() + CHECKOUT_HOLD_MINUTES * 60_000);
const LINK = { trigger: 'provider_link' } as const;

let clock = NOW;
const deps = (): OrderDeps => ({ db: testDb.db, queue, now: () => clock });
const ctx = () => ({ spaceId: guest.spaceId, language: 'en' as const });

beforeAll(async () => {
  testDb = await createTestDatabase();
  boss = new PgBoss({ connectionString: testDb.url, supervise: false, schedule: false });
  boss.on('error', console.error);
  await boss.start();
  await ensureQueues(boss);
  queue = createJobQueue(boss);
  guest = await seedGuestUnit(testDb.db, { now: NOW });
});

afterAll(async () => {
  await boss?.stop({ graceful: false, timeout: 1000 });
  await testDb?.drop();
});

async function codeOf(run: Promise<unknown>) {
  const error = await run.then(
    () => undefined,
    (e: unknown) => e,
  );
  return error instanceof RespondRuleError ? error.code : 'ok';
}

async function provider(online = false) {
  const seeded = await seedProvider(testDb.db, { commissionBp: 1250 });
  if (online) {
    await testDb.db
      .update(providers)
      .set({ stripeAccountId: 'acct_test', stripeCardPayments: 'active' })
      .where(eq(providers.id, seeded.id));
  }
  return seeded.id;
}

/** A pay-direct on-request Order the Provider answered with another time: v2 awaits the guest. */
async function newTerms() {
  clock = NOW;
  const { offerId } = await seedOrderableOffer(testDb.db, {
    providerId: await provider(),
    availabilityMode: 'on_request',
  });
  const { order } = await createOrder(deps(), {
    spaceId: guest.spaceId,
    offerId,
    date: DAY,
    quantity: 2,
    contact: { email: 'guest@example.test' },
  });
  const v1 = order.currentProposalId ?? '';
  const proposed = await providerPropose(
    deps(),
    { orderId: order.id, proposalId: v1 },
    { date: '2027-05-05', time: '10:00' },
    LINK,
  );
  expect(proposed.outcome).toBe('applied');
  return { orderId: order.id, v1 };
}

const events = async (orderId: string) =>
  (await testDb.db.select().from(orderEvents).where(eq(orderEvents.orderId, orderId))).length;

async function notifyKinds(orderId: string) {
  const { rows } = await testDb.db.execute<{ kind: string }>(
    sql`select data->>'kind' as kind from pgboss.job where name = ${QUEUES.orderNotify} and data->>'orderId' = ${orderId} order by created_on, id`,
  );
  return rows.map((r) => r.kind);
}

describe('respond_to_order_update', () => {
  it('shows the new and the earlier terms on the card', async () => {
    const { orderId } = await newTerms();
    const { draft } = await prepareRespond(deps(), ctx(), { orderId });
    expect(draft).toMatchObject({
      orderId,
      proposer: 'provider_time',
      date: '2027-05-05',
      startsAtLocal: '2027-05-05T10:00',
      quantity: 2,
      priceMinor: 5000,
      previous: { date: DAY, startsAtLocal: null, priceMinor: 5000 },
      paymentMode: 'direct',
      respondBy: '2027-05-02T10:00:00.000Z',
      respondByLocal: '2027-05-02T12:00',
      // Accepting confirms the Order: the card shows the terms after acceptance.
      cancellation: { awaitingAcceptance: null, freeUntilLocal: '2027-05-04T10:00' },
    });
  });

  it('accepts: a pay-direct Order is confirmed and the Provider told', async () => {
    const { orderId } = await newTerms();
    const { pendingId } = await prepareRespond(deps(), ctx(), { orderId });
    const result = await completeRespond(deps(), {
      pendingId,
      spaceId: guest.spaceId,
      answer: 'accept',
    });
    expect(result).toMatchObject({
      outcome: 'accepted',
      order: { status: 'confirmed', respondBy: null },
    });
    expect(await notifyKinds(orderId)).toEqual(
      expect.arrayContaining(['order_confirmed', 'provider_confirmed']),
    );
    // A double tap returns the same answer.
    const again = await completeRespond(deps(), {
      pendingId,
      spaceId: guest.spaceId,
      answer: 'decline',
    });
    expect(again).toMatchObject({ outcome: 'accepted' });
    expect((await getOrder(testDb.db, orderId))?.order.status).toBe('confirmed');
  });

  it('declines: the Order is cancelled', async () => {
    const { orderId } = await newTerms();
    const { pendingId } = await prepareRespond(deps(), ctx(), { orderId });
    const result = await completeRespond(deps(), {
      pendingId,
      spaceId: guest.spaceId,
      answer: 'decline',
    });
    expect(result).toMatchObject({ outcome: 'declined', order: { status: 'cancelled' } });
  });

  it('refuses a card whose terms were already answered, writing nothing', async () => {
    const { orderId } = await newTerms();
    const first = await prepareRespond(deps(), ctx(), { orderId });
    const second = await prepareRespond(deps(), ctx(), { orderId });
    await completeRespond(deps(), {
      pendingId: first.pendingId,
      spaceId: guest.spaceId,
      answer: 'accept',
    });
    const before = await events(orderId);
    expect(
      await codeOf(
        completeRespond(deps(), {
          pendingId: second.pendingId,
          spaceId: guest.spaceId,
          answer: 'decline',
        }),
      ),
    ).toBe('stale');
    expect(await events(orderId)).toBe(before);
    expect((await getOrder(testDb.db, orderId))?.order.status).toBe('confirmed');
  });

  it('refuses a card for a proposal that is no longer current', async () => {
    const { orderId, v1 } = await newTerms();
    // A card minted for the superseded terms (as if prepared before the Provider answered).
    const { pendingId } = await prepareRespond(deps(), ctx(), { orderId });
    await testDb.db.execute(
      sql`update pending_actions set payload = jsonb_set(payload, '{proposalId}', to_jsonb(${v1}::text)) where id = ${pendingId}`,
    );
    expect(
      await codeOf(
        completeRespond(deps(), { pendingId, spaceId: guest.spaceId, answer: 'accept' }),
      ),
    ).toBe('stale');
    expect((await getOrder(testDb.db, orderId))?.order.status).toBe('awaiting_confirmation');
  });

  it('refuses once the card window has passed', async () => {
    const { orderId } = await newTerms();
    const { pendingId } = await prepareRespond(deps(), ctx(), { orderId });
    clock = new Date('2027-05-02T10:00:00Z');
    expect(
      await codeOf(
        completeRespond(deps(), { pendingId, spaceId: guest.spaceId, answer: 'accept' }),
      ),
    ).toBe('card-expired');
    const found = await getOrder(testDb.db, orderId);
    await runOrderTimer(deps(), {
      orderId,
      proposalId: found?.proposal.id ?? '',
      operation: 'card_expiry',
    });
    expect((await getOrder(testDb.db, orderId))?.order.status).toBe('expired');
    expect(await codeOf(prepareRespond(deps(), ctx(), { orderId }))).toBe('card-expired');
    clock = NOW;
  });

  it('has nothing to answer for an Order without new terms, or another space', async () => {
    clock = NOW;
    const { offerId } = await seedOrderableOffer(testDb.db, {
      providerId: await provider(),
      availabilityMode: 'on_request',
    });
    const { order } = await createOrder(deps(), {
      spaceId: guest.spaceId,
      offerId,
      date: DAY,
      quantity: 1,
      contact: { email: 'guest@example.test' },
    });
    expect(await codeOf(prepareRespond(deps(), ctx(), { orderId: order.id }))).toBe('no-update');
    const other = await seedGuestUnit(testDb.db, { now: NOW });
    const { orderId } = await newTerms();
    expect(
      await codeOf(prepareRespond(deps(), { spaceId: other.spaceId, language: 'en' }, { orderId })),
    ).toBe('not-found');
  });

  it('refuses a pending record minted for another tool', async () => {
    const { orderId } = await newTerms();
    const { pendingId } = await prepareCancel(deps(), ctx(), { orderId });
    expect(
      await codeOf(
        completeRespond(deps(), { pendingId, spaceId: guest.spaceId, answer: 'accept' }),
      ),
    ).toBe('not-found');
  });

  it('works after checkout while the Order is unresolved, and not once it is confirmed', async () => {
    clock = NOW;
    const { offerId } = await seedOrderableOffer(testDb.db, {
      providerId: await provider(),
      availabilityMode: 'on_request',
    });
    const { order } = await createOrder(deps(), {
      spaceId: guest.spaceId,
      offerId,
      date: DAY,
      quantity: 1,
      contact: { email: 'guest@example.test' },
    });
    // The admin's new terms, with a card window reaching past the stay.
    await propose(deps(), {
      orderId: order.id,
      proposalId: order.currentProposalId ?? '',
      trigger: 'admin',
      proposer: 'admin',
      terms: { date: '2027-05-06', quantity: 1 },
      cardExpiresAt: new Date('2027-05-09T10:00:00Z'),
    });
    clock = new Date('2027-05-08T10:00:00Z');
    const { pendingId, draft } = await prepareRespond(deps(), ctx(), { orderId: order.id });
    expect(draft.proposer).toBe('admin');
    const result = await completeRespond(deps(), {
      pendingId,
      spaceId: guest.spaceId,
      answer: 'accept',
    });
    expect(result.order.status).toBe('confirmed');
    expect(await codeOf(prepareRespond(deps(), ctx(), { orderId: order.id }))).toBe('no-update');
    clock = NOW;
  });
});

describe('a price change on a pay-online Order', () => {
  const gateway = () => fakePaymentGateway({ now: () => clock });

  async function runJobs(pdeps: () => PaymentDeps, attemptId: string, only?: PaymentOperation[]) {
    const ran: string[] = [];
    for (let round = 0; round < 20; round++) {
      const { rows } = await testDb.db.execute<{ id: string; data: OrderPaymentJobData }>(
        sql`select id, data from pgboss.job where name = ${QUEUES.orderPayment} and state = 'created'
            and data->>'attemptId' = ${attemptId} order by created_on, id`,
      );
      const due = rows.filter((r) => !only || only.includes(r.data.operation));
      if (due.length === 0) return ran;
      for (const job of due) {
        const { operation, outcome } = await runPaymentJob(pdeps(), job.data);
        ran.push(`${operation}:${outcome}`);
        await testDb.db.execute(
          sql`update pgboss.job set state = 'completed' where id = ${job.id}`,
        );
      }
    }
    throw new Error('payment jobs kept coming');
  }

  const attemptsOf = (orderId: string) =>
    testDb.db
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.orderId, orderId))
      .orderBy(paymentAttempts.proposalVersion);

  it('voids v1, then pays v2 on a new attempt under new keys', async () => {
    clock = NOW;
    const g = gateway();
    const pdeps = (): PaymentDeps => ({ ...deps(), gateway: g, guestOrigin: 'http://guest.test' });
    const deliver = async () => {
      for (const event of g.takeEvents()) await applyStripeEvent(deps(), parseStripeEvent(event));
    };
    const { offerId } = await seedOrderableOffer(testDb.db, {
      providerId: await provider(true),
      availabilityMode: 'on_request',
      paymentMode: 'online',
      priceMinor: 2500,
    });
    const { order } = await createOrder(deps(), {
      spaceId: guest.spaceId,
      offerId,
      date: DAY,
      quantity: 2,
      contact: { email: 'guest@example.test' },
      hold: { expiresAt: HOLD_UNTIL },
    });
    const [v1] = await attemptsOf(order.id);
    if (!v1) throw new Error('no attempt');
    await runJobs(pdeps, v1.id, ['open']);
    const [opened] = await attemptsOf(order.id);
    g.pay(opened?.sessionId as string);
    await deliver();
    expect((await getOrder(testDb.db, order.id))?.order).toMatchObject({
      status: 'pending_provider',
      paymentStatus: 'authorized',
    });

    // The Provider names a higher price: v1's authorization is voided, Payment starts again.
    const proposed = await providerPropose(
      deps(),
      { orderId: order.id, proposalId: v1.proposalId },
      { date: DAY, priceMinor: 6000 },
      LINK,
    );
    expect(proposed.order).toMatchObject({
      status: 'awaiting_confirmation',
      paymentStatus: 'none',
    });
    // The intent is cancelled at Stripe; the superseded attempt leaves Payment status alone.
    expect(await runJobs(pdeps, v1.id)).toEqual(['void:stale']);
    expect(g.calls.filter((c) => c.op === 'cancel')).toHaveLength(1);
    expect((await attemptsOf(order.id))[0]?.intentStatus).toBe('canceled');
    await deliver();
    expect((await getOrder(testDb.db, order.id))?.order.paymentStatus).toBe('none');

    // The guest accepts: a new attempt for v2, under keys carrying version 2.
    const { pendingId } = await prepareRespond(deps(), ctx(), { orderId: order.id });
    const accepted = await completeRespond(deps(), {
      pendingId,
      spaceId: guest.spaceId,
      answer: 'accept',
    });
    expect(accepted.order).toMatchObject({ status: 'confirming', priceMinor: 6000 });
    expect(accepted.order.payBy).not.toBeNull();
    const [, v2] = await attemptsOf(order.id);
    if (!v2) throw new Error('no v2 attempt');
    expect(v2).toMatchObject({ proposalVersion: 2, amountMinor: 6000 });
    const v2Key = stripeIdempotencyKey(v2, 'create_session');
    expect(v2Key).toContain(':proposal:2:');
    expect(v2Key).not.toBe(stripeIdempotencyKey(v1, 'create_session'));

    await runJobs(pdeps, v2.id, ['open']);
    const created = g.calls.filter((c) => c.op === 'create_session');
    expect(created.at(-1)?.idempotencyKey).toBe(v2Key);
    const [, opened2] = await attemptsOf(order.id);
    g.pay(opened2?.sessionId as string);
    await deliver();
    // Terms the Provider proposed are confirmed without a second ask, then captured.
    expect(await runJobs(pdeps, v2.id)).toEqual(['confirm:applied', 'capture:applied']);
    await deliver();
    expect((await getOrder(testDb.db, order.id))?.order).toMatchObject({
      status: 'confirmed',
      paymentStatus: 'captured',
    });
    const [row] = await testDb.db.select().from(orders).where(eq(orders.id, order.id));
    expect(row?.currentProposalId).toBe(v2.proposalId);
  });
});
