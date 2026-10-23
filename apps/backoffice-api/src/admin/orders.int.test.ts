import {
  applyStripeEvent,
  CHECKOUT_HOLD_MINUTES,
  completeCancel,
  createJobQueue,
  createOrder,
  type OrderDeps,
  type OrderPaymentJobData,
  offers,
  orderEvents,
  orders,
  parseStripeEvent,
  paymentAttempts,
  prepareCancel,
  providers,
  QUEUES,
  runPaymentJob,
} from '@fetivi/domain';
import {
  fakePaymentGateway,
  seedGuestUnit,
  seedOrderableOffer,
  seedProvider,
} from '@fetivi/domain/testing';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdmin } from '../cli/create-admin';
import {
  createTestApp,
  get,
  loginAs,
  PASSWORD,
  post,
  signUpVerifiedHost,
  type TestApp,
} from '../testing';

// The admin Order page's API (35): the view, a cancel with a refund override and a refund of a
// released Order, each an OrderEvent with trigger admin, the actor and a note.

let t: TestApp;
let hostCookie: string;
let adminId: string;
let adminCookie: string;
const gateway = () => fakePaymentGateway({ now: t.clock.now });
let w: ReturnType<typeof gateway>;

const deps = (): OrderDeps => ({ db: t.db, queue: createJobQueue(t.boss), now: t.clock.now });
const pdeps = () => ({ ...deps(), gateway: w, guestOrigin: 'http://guest.test' });

beforeAll(async () => {
  t = await createTestApp();
  w = gateway();
  await signUpVerifiedHost(t, 'host@example.test');
  hostCookie = await loginAs(t, 'host@example.test');
  const created = await createAdmin(t.db, 'admin@example.test', PASSWORD);
  if (!created.ok) throw new Error('admin not created');
  adminId = created.id;
  adminCookie = await loginAs(t, 'admin@example.test');
});

afterAll(async () => {
  await t?.close();
});

async function runJobs(attemptId: string) {
  for (let round = 0; round < 20; round++) {
    const { rows } = await t.db.execute<{ id: string; data: OrderPaymentJobData }>(
      sql`select id, data from pgboss.job where name = ${QUEUES.orderPayment} and state = 'created'
          and data->>'attemptId' = ${attemptId} order by created_on, id`,
    );
    if (rows.length === 0) return;
    for (const job of rows) {
      await runPaymentJob(pdeps(), job.data);
      await t.db.execute(sql`update pgboss.job set state = 'completed' where id = ${job.id}`);
    }
    for (const event of w.takeEvents()) {
      await applyStripeEvent(deps(), parseStripeEvent(event));
    }
  }
  throw new Error('payment jobs kept coming');
}

/** A captured pay-online Order of 2 × 25.00 EUR (commission 10 %), 24 h free then `percent`. */
async function paidOrder(percent = 30) {
  const now = t.clock.now();
  const guest = await seedGuestUnit(t.db, { now });
  const provider = await seedProvider(t.db, { commissionBp: 1000 });
  await t.db
    .update(providers)
    .set({ stripeAccountId: 'acct_test', stripeCardPayments: 'active' })
    .where(eq(providers.id, provider.id));
  const day = new Date(Date.parse(`${guest.stay.checkIn}T00:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
  const offer = await seedOrderableOffer(t.db, {
    providerId: provider.id,
    availabilityMode: 'allotment',
    paymentMode: 'online',
    priceMinor: 2500,
    capacity: 4,
    startsAt: new Date(`${day}T07:00:00Z`),
  });
  await t.db
    .update(offers)
    .set({ freeCancelHoursBefore: 24, refundPercentAfter: percent })
    .where(eq(offers.id, offer.offerId));
  const { order } = await createOrder(deps(), {
    spaceId: guest.spaceId,
    offerId: offer.offerId,
    slotId: offer.slotId as string,
    date: day,
    quantity: 2,
    contact: { email: 'guest@example.test' },
    hold: { expiresAt: new Date(now.getTime() + CHECKOUT_HOLD_MINUTES * 60_000) },
  });
  const attempt = await attemptOfOrder(order.id);
  await runJobs(attempt.id);
  w.pay((await attemptOfOrder(order.id)).sessionId as string);
  for (const event of w.takeEvents()) {
    await applyStripeEvent(deps(), parseStripeEvent(event));
  }
  await runJobs(attempt.id);
  const paid = await orderOf(order.id);
  if (paid.paymentStatus !== 'captured') throw new Error(`not captured: ${paid.paymentStatus}`);
  return { orderId: order.id, attemptId: attempt.id, spaceId: guest.spaceId };
}

async function attemptOfOrder(orderId: string) {
  const [attempt] = await t.db
    .select()
    .from(paymentAttempts)
    .where(eq(paymentAttempts.orderId, orderId));
  if (!attempt) throw new Error('no attempt');
  return attempt;
}

async function orderOf(id: string) {
  const [order] = await t.db.select().from(orders).where(eq(orders.id, id));
  if (!order) throw new Error('no order');
  return order;
}

const path = (id: string, action = '') => `/api/admin/orders/${id}${action}`;

describe('admin Order page API', () => {
  it('is for the admin only, and 404 for an unknown Order', async () => {
    const { orderId } = await paidOrder();
    expect((await get(t.app, path(orderId))).statusCode).toBe(401);
    expect((await get(t.app, path(orderId), hostCookie)).statusCode).toBe(403);
    expect((await post(t.app, path(orderId, '/cancel'), {}, hostCookie)).statusCode).toBe(403);
    expect((await post(t.app, path(orderId, '/refund'), {}, hostCookie)).statusCode).toBe(403);
    const unknown = '00000000-0000-4000-8000-000000000000';
    expect((await get(t.app, path(unknown), adminCookie)).statusCode).toBe(404);
  });

  it('shows the Order, its policy refund now and what the admin may do', async () => {
    const { orderId } = await paidOrder();
    const res = await get(t.app, path(orderId), adminCookie);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: orderId,
      status: 'confirmed',
      paymentStatus: 'captured',
      paymentMode: 'online',
      priceMinor: 5000,
      freeCancelHoursBefore: 24,
      refundPercentAfter: 30,
      // Days before the start: the cancel is still free.
      policyRefundMinor: 5000,
      paidAmountMinor: 5000,
      refundAmountMinor: null,
      canCancel: true,
      canRefund: false,
    });
    expect(res.json().events.length).toBeGreaterThan(0);
  });

  it('cancels with an override: an admin OrderEvent, then a proportional Stripe refund', async () => {
    const { orderId, attemptId } = await paidOrder();
    const res = await post(
      t.app,
      path(orderId, '/cancel'),
      { refundMinor: 1234, note: 'goodwill' },
      adminCookie,
    );
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: 'cancelled',
      paymentStatus: 'refund_pending',
      refundAmountMinor: 1234,
      canCancel: false,
    });
    const events = await t.db
      .select()
      .from(orderEvents)
      .where(eq(orderEvents.orderId, orderId))
      .orderBy(orderEvents.id);
    const cancelled = events.find(
      (e) => e.toStatus === 'cancelled' && e.fromStatus !== 'cancelled',
    );
    expect(cancelled).toMatchObject({ trigger: 'admin', actorId: adminId });
    expect(cancelled?.note).toBe('refund override: 12.34 of 50.00 EUR; goodwill');
    expect(
      res.json().events.some((e: { actorEmail: string }) => e.actorEmail === 'admin@example.test'),
    ).toBe(true);

    await runJobs(attemptId);
    const [refund] = w.state().refunds;
    expect(refund).toMatchObject({ amountMinor: 1234, applicationFeeRefundedMinor: 123 });
    expect((await orderOf(orderId)).paymentStatus).toBe('refunded');
  });

  it('refunds after a 0 % guest cancel once; a second refund is refused', async () => {
    const { orderId, spaceId } = await paidOrder(0);
    // Past the cutoff: the guest's cancel refunds nothing and the money stays captured.
    const real = t.clock.now().getTime();
    const order = await orderOf(orderId);
    const start = new Date(`${order.date}T07:00:00Z`).getTime();
    t.clock.advance(start - 60 * 60_000 - real);
    const { pendingId } = await prepareCancel(
      { db: t.db, now: t.clock.now },
      { spaceId, language: 'en' },
      { orderId },
    );
    expect(await completeCancel(deps(), { pendingId, spaceId })).toMatchObject({
      outcome: 'cancelled',
    });
    const before = await get(t.app, path(orderId), adminCookie);
    expect(before.json()).toMatchObject({
      status: 'cancelled',
      paymentStatus: 'captured',
      refundAmountMinor: 0,
      canRefund: true,
    });

    const res = await post(t.app, path(orderId, '/refund'), { refundMinor: 2000 }, adminCookie);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      paymentStatus: 'refund_pending',
      refundAmountMinor: 2000,
      canRefund: false,
    });
    const again = await post(t.app, path(orderId, '/refund'), { refundMinor: 500 }, adminCookie);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: 'not-refundable' });
  });

  it('refuses an override above the amount, a bad body, and a second cancel', async () => {
    const { orderId } = await paidOrder();
    const over = await post(t.app, path(orderId, '/cancel'), { refundMinor: 5001 }, adminCookie);
    expect(over.statusCode).toBe(400);
    const bad = await post(t.app, path(orderId, '/refund'), { refundMinor: 0 }, adminCookie);
    expect(bad.statusCode).toBe(400);
    expect((await orderOf(orderId)).status).toBe('confirmed');

    expect((await post(t.app, path(orderId, '/cancel'), {}, adminCookie)).statusCode).toBe(200);
    const twice = await post(t.app, path(orderId, '/cancel'), {}, adminCookie);
    // Cancelling a cancelled Order changes nothing more.
    expect(twice.statusCode).toBe(200);
    expect(twice.json()).toMatchObject({ status: 'cancelled', refundAmountMinor: 5000 });
    expect((await orderOf(orderId)).paymentStatus).toBe('refund_pending');
  });
});

/** A pay-direct on-request Order waiting for the Provider (36). */
async function pendingOrder() {
  const now = t.clock.now();
  const guest = await seedGuestUnit(t.db, { now });
  const provider = await seedProvider(t.db);
  const { offerId } = await seedOrderableOffer(t.db, {
    providerId: provider.id,
    availabilityMode: 'on_request',
  });
  const { order } = await createOrder(deps(), {
    spaceId: guest.spaceId,
    offerId,
    date: guest.stay.checkIn,
    quantity: 2,
    contact: { email: 'guest@example.test' },
  });
  return { orderId: order.id, proposalId: order.currentProposalId as string, stay: guest.stay };
}

describe("recording the Provider's phoned answer", () => {
  it('is for the admin only', async () => {
    const { orderId, proposalId } = await pendingOrder();
    const body = { proposalId, note: 'Phoned: yes' };
    expect((await post(t.app, path(orderId, '/accept'), body)).statusCode).toBe(401);
    expect((await post(t.app, path(orderId, '/accept'), body, hostCookie)).statusCode).toBe(403);
    expect((await post(t.app, path(orderId, '/decline'), body, hostCookie)).statusCode).toBe(403);
    expect((await post(t.app, path(orderId, '/propose'), body, hostCookie)).statusCode).toBe(403);
  });

  it('shows the due time and that the admin may answer', async () => {
    const { orderId, proposalId } = await pendingOrder();
    const res = await get(t.app, path(orderId), adminCookie);
    expect(res.json()).toMatchObject({
      status: 'pending_provider',
      canAnswer: true,
      windowMissed: false,
      proposalId,
      proposer: 'offer',
      version: 1,
      orderKind: 'booking',
      zone: 'Europe/Zagreb',
    });
    expect(res.json().responseDueAt).toEqual(expect.any(String));
  });

  it('confirms on accept, as an admin OrderEvent with the actor and the note', async () => {
    const { orderId, proposalId } = await pendingOrder();
    const body = { proposalId, note: 'Phoned: they can do it' };
    const res = await post(t.app, path(orderId, '/accept'), body, adminCookie);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'confirmed', canAnswer: false });
    const last = res.json().events.at(-1);
    expect(last).toMatchObject({
      trigger: 'admin',
      to: 'confirmed',
      note: 'Phoned: they can do it',
      actorEmail: 'admin@example.test',
    });
    const [event] = await t.db.select().from(orderEvents).where(eq(orderEvents.id, last.id));
    expect(event?.actorId).toBe(adminId);
  });

  it('declines, and records new terms the guest then answers', async () => {
    const declined = await pendingOrder();
    const no = { proposalId: declined.proposalId, note: 'Phoned: fully booked' };
    const res = await post(t.app, path(declined.orderId, '/decline'), no, adminCookie);
    expect(res.json().status).toBe('declined');

    const { orderId, proposalId, stay } = await pendingOrder();
    const terms = { proposalId, note: 'Phoned: 18:00 works', date: stay.checkout, time: '18:00' };
    const proposed = await post(t.app, path(orderId, '/propose'), terms, adminCookie);
    expect(proposed.statusCode).toBe(200);
    expect(proposed.json()).toMatchObject({
      status: 'awaiting_confirmation',
      proposer: 'admin',
      version: 2,
      date: stay.checkout,
    });
  });

  it('refuses a stale proposal, a missing note, a bad date and a date outside the stay', async () => {
    const { orderId, proposalId, stay } = await pendingOrder();
    const missing = await post(t.app, path(orderId, '/accept'), { proposalId }, adminCookie);
    expect(missing.statusCode).toBe(400);
    const badDate = { proposalId, note: 'x', date: '2026-02-30' };
    expect((await post(t.app, path(orderId, '/propose'), badDate, adminCookie)).statusCode).toBe(
      400,
    );
    const outside = { proposalId, note: 'x', date: '2030-01-01' };
    const outsideRes = await post(t.app, path(orderId, '/propose'), outside, adminCookie);
    expect(outsideRes.statusCode).toBe(400);
    expect(stay.checkout < outside.date).toBe(true);
    const stale = {
      proposalId: '00000000-0000-4000-8000-000000000000',
      note: 'Phoned: yes',
    };
    const res = await post(t.app, path(orderId, '/accept'), stale, adminCookie);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('not-answerable');
    expect((await orderOf(orderId)).status).toBe('pending_provider');
  });
});
