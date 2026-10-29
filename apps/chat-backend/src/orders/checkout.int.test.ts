import {
  completeOrder,
  fromLocalDateTime,
  loadSituation,
  paymentAttempts,
  prepareOrder,
  providers,
} from '@fetivi/domain';
import {
  noopQueue,
  publishOffer,
  seedDestination,
  seedGuestUnit,
  seedOrderableOffer,
  seedProvider,
} from '@fetivi/domain/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ChatTestApp, createChatTestApp, enterSpace, write } from '../testing';

let t: ChatTestApp;

beforeAll(async () => {
  t = await createChatTestApp({ model: null });
  // One destination: every space below falls inside it.
  await seedDestination(t.db);
});

afterAll(async () => {
  await t?.close();
});

const plusDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const checkout = (orderId: string, cookie?: string) =>
  write('POST', t.app, `/api/orders/${orderId}/checkout`, undefined, { cookie });

/** A pay-online Order of a fresh space, made through the domain halves as create_order does. */
async function placeOnlineOrder() {
  const seed = await seedGuestUnit(t.db, { now: t.clock.now(), checkInInDays: 2 });
  const { cookie, space } = await enterSpace(t, seed);
  const provider = await seedProvider(t.db, { commissionBp: 1250 });
  await t.db
    .update(providers)
    .set({ stripeAccountId: 'acct_checkout_test', stripeCardPayments: 'active' })
    .where(eq(providers.id, provider.id));
  const ctx = await loadSituation(t.db, space.space.id, t.clock.now());
  if (!ctx) throw new Error('no space');
  const day = plusDays(seed.stay.checkIn, 1);
  const boat = await seedOrderableOffer(t.db, {
    providerId: provider.id,
    destinationId: ctx.destinationId ?? undefined,
    availabilityMode: 'allotment',
    paymentMode: 'online',
    priceMinor: 4500,
    startsAt: fromLocalDateTime(`${day}T09:00`, 'Europe/Zagreb'),
    capacity: 10,
  });
  await publishOffer(t.db, boat.offerId);
  const scope = {
    destinationId: ctx.destinationId,
    propertyId: ctx.propertyId,
    language: ctx.language,
  };
  const deps = { db: t.db, queue: noopQueue, now: t.clock.now };
  const { pendingId } = await prepareOrder(
    deps,
    { spaceId: space.space.id, offerScope: scope },
    { offerId: boat.offerId, date: day, quantity: 1 },
  );
  const { order } = await completeOrder(deps, {
    pendingId,
    spaceId: space.space.id,
    offerScope: scope,
    contact: { email: 'guest@example.test', name: 'Ana' },
    details: { note: null, time: null },
  });
  return { cookie, orderId: order.id };
}

describe('POST /api/orders/:id/checkout', () => {
  it('needs a space and answers only for its own Orders', async () => {
    const { orderId } = await placeOnlineOrder();
    expect((await checkout(orderId)).statusCode).toBe(401);
    const other = await placeOnlineOrder();
    const response = await checkout(orderId, other.cookie);
    expect([response.statusCode, response.json()]).toEqual([404, { error: 'not-found' }]);
    expect((await checkout('not-a-uuid', other.cookie)).statusCode).toBe(400);
  });

  it('is preparing, then ready with the stored URL, then closed after the window', async () => {
    const { cookie, orderId } = await placeOnlineOrder();
    expect((await checkout(orderId, cookie)).json()).toEqual({ state: 'preparing' });

    const url = 'https://checkout.stripe.com/c/pay/cs_test_x';
    await t.db
      .update(paymentAttempts)
      .set({ checkoutUrl: url, sessionId: `cs_test_${orderId}`, sessionStatus: 'open' })
      .where(eq(paymentAttempts.orderId, orderId));
    expect((await checkout(orderId, cookie)).json()).toEqual({ state: 'ready', url });

    t.clock.advance(31 * 60_000);
    expect((await checkout(orderId, cookie)).json()).toEqual({ state: 'closed' });
  });
});
