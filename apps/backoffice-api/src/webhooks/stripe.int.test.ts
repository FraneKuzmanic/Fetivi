import { createHmac, randomBytes } from 'node:crypto';
import {
  createJobQueue,
  createOrder,
  createStripeGateway,
  orderEvents,
  orders,
  paymentAttempts,
  providers,
} from '@fetivi/domain';
import { seedGuestUnit, seedOrderableOffer, seedProvider } from '@fetivi/domain/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../testing';

const SECRET = `whsec_${randomBytes(24).toString('hex')}`;
const ACCOUNT = 'acct_webhook_test';

// The real gateway, only for its signature check: it never calls Stripe here.
const gateway = createStripeGateway({
  apiKey: 'sk_test_dummy',
  fetch: () => Promise.reject(new Error('no network in tests')),
});

let t: TestApp;
let bare: TestApp;

beforeAll(async () => {
  t = await createTestApp({ stripe: { gateway, webhookSecret: SECRET } });
  bare = await createTestApp({ stripe: { gateway } });
});

afterAll(async () => {
  await t?.close();
  await bare?.close();
});

/** A Stripe delivery, signed like Stripe (`t=<unix>,v1=<hmac>`) with `secret`. */
function deliver(app: TestApp, event: unknown, secret = SECRET) {
  const body = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return app.app.inject({
    method: 'POST',
    url: '/webhooks/stripe',
    headers: { 'content-type': 'application/json', 'stripe-signature': `t=${timestamp},v1=${v1}` },
    payload: body,
  });
}

async function placeOnlineOrder() {
  const now = t.clock.now();
  const provider = await seedProvider(t.db, { commissionBp: 1250 });
  await t.db
    .update(providers)
    .set({ stripeAccountId: ACCOUNT, stripeCardPayments: 'active' })
    .where(eq(providers.id, provider.id));
  const { offerId, slotId } = await seedOrderableOffer(t.db, {
    providerId: provider.id,
    availabilityMode: 'allotment',
    paymentMode: 'online',
    priceMinor: 2500,
    startsAt: new Date('2026-10-21T07:00:00Z'),
  });
  const unit = await seedGuestUnit(t.db, { now });
  const { order } = await createOrder(
    { db: t.db, queue: createJobQueue(t.boss), now: t.clock.now },
    {
      spaceId: unit.spaceId,
      offerId,
      slotId,
      date: '2026-10-21',
      quantity: 1,
      contact: { email: 'guest@example.test' },
      hold: { expiresAt: new Date(now.getTime() + 30 * 60_000) },
    },
  );
  const [attempt] = await t.db
    .select()
    .from(paymentAttempts)
    .where(eq(paymentAttempts.orderId, order.id));
  if (!attempt) throw new Error('no attempt');
  return { orderId: order.id, attemptId: attempt.id };
}

const completed = (attemptId: string, id = `evt_${randomBytes(6).toString('hex')}`) => ({
  id,
  type: 'checkout.session.completed',
  account: ACCOUNT,
  data: {
    object: {
      id: `cs_test_${randomBytes(6).toString('hex')}`,
      status: 'complete',
      payment_status: 'unpaid',
      client_reference_id: attemptId,
      payment_intent: `pi_test_${randomBytes(6).toString('hex')}`,
    },
  },
});

const paymentOf = async (orderId: string) =>
  (await t.db.select().from(orders).where(eq(orders.id, orderId)))[0]?.paymentStatus;

const eventsOf = async (orderId: string) =>
  (await t.db.select().from(orderEvents).where(eq(orderEvents.orderId, orderId))).length;

describe('POST /webhooks/stripe', () => {
  it('refuses a bad signature', async () => {
    const { attemptId } = await placeOnlineOrder();
    const response = await deliver(t, completed(attemptId), 'whsec_other');
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'bad-signature' });
  });

  it('authorizes on a completed checkout, once per event id', async () => {
    const { orderId, attemptId } = await placeOnlineOrder();
    const before = await eventsOf(orderId);
    const event = completed(attemptId);
    expect((await deliver(t, event)).statusCode).toBe(200);
    expect(await paymentOf(orderId)).toBe('authorized');
    expect(await eventsOf(orderId)).toBe(before + 1);
    // Stripe redelivers the same event: no second change.
    expect((await deliver(t, event)).statusCode).toBe(200);
    expect(await eventsOf(orderId)).toBe(before + 1);
    const [attempt] = await t.db
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.id, attemptId));
    expect(attempt?.processedEventIds).toEqual([event.id]);
  });

  it('acknowledges and ignores an event of another account or an unknown type', async () => {
    const { orderId, attemptId } = await placeOnlineOrder();
    const foreign = { ...completed(attemptId), account: 'acct_someone_else' };
    expect((await deliver(t, foreign)).statusCode).toBe(200);
    expect(await paymentOf(orderId)).toBe('none');
    const other = { id: 'evt_other', type: 'customer.created', data: { object: { id: 'cus_1' } } };
    const response = await deliver(t, other);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it('is not registered without a webhook secret', async () => {
    expect((await deliver(bare, { id: 'evt_x', type: 'x', data: { object: {} } })).statusCode).toBe(
      404,
    );
  });
});
