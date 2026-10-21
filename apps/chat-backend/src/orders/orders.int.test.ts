import { completeOrder, fromLocalDateTime, loadSituation, prepareOrder } from '@fetivi/domain';
import {
  noopQueue,
  publishOffer,
  seedDestination,
  seedGuestUnit,
  seedOrderableOffer,
  seedProvider,
} from '@fetivi/domain/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ChatTestApp, createChatTestApp, enterSpace, get } from '../testing';

let t: ChatTestApp;

beforeAll(async () => {
  t = await createChatTestApp({ model: null });
});

afterAll(async () => {
  await t?.close();
});

const plusDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** One Order made through the domain halves, as create_order makes it. */
async function placeOrder(spaceId: string, offerId: string, date: string, quantity: number) {
  const ctx = await loadSituation(t.db, spaceId, t.clock.now());
  if (!ctx) throw new Error('no space');
  const scope = {
    destinationId: ctx.destinationId,
    propertyId: ctx.propertyId,
    language: ctx.language,
  };
  const deps = { db: t.db, queue: noopQueue, now: t.clock.now };
  const { pendingId } = await prepareOrder(
    deps,
    { spaceId, offerScope: scope },
    { offerId, date, quantity },
  );
  return completeOrder(deps, {
    pendingId,
    spaceId,
    offerScope: scope,
    contact: { email: 'guest@example.test', name: 'Ana' },
  });
}

describe('GET /api/orders', () => {
  it('needs a space', async () => {
    const response = await get(t.app, '/api/orders');
    expect([response.statusCode, response.json()]).toEqual([401, { error: 'no-space' }]);
  });

  it('lists every Order of the space with both statuses, newest first, also after checkout', async () => {
    const seed = await seedGuestUnit(t.db, { now: t.clock.now(), checkInInDays: 2 });
    const { cookie, space } = await enterSpace(t, seed);
    expect((await get(t.app, '/api/orders', cookie)).json()).toEqual({ orders: [] });

    const destinationId = await seedDestination(t.db);
    const provider = await seedProvider(t.db);
    const day = plusDays(seed.stay.checkIn, 1);
    const boat = await seedOrderableOffer(t.db, {
      providerId: provider.id,
      destinationId,
      availabilityMode: 'allotment',
      startsAt: fromLocalDateTime(`${day}T09:00`, 'Europe/Zagreb'),
      capacity: 10,
      title: 'Blue Lagoon boat trip',
    });
    await publishOffer(t.db, boat.offerId);
    const first = await placeOrder(space.space.id, boat.offerId, day, 2);
    t.clock.advance(1000);
    const second = await placeOrder(space.space.id, boat.offerId, day, 1);

    const listed = (await get(t.app, '/api/orders', cookie)).json() as {
      orders: { id: string; status: string; paymentStatus: string; offerTitle: string }[];
    };
    expect(listed.orders.map((o) => o.id)).toEqual([second.order.id, first.order.id]);
    expect(listed.orders[0]).toMatchObject({
      status: 'confirmed',
      paymentStatus: 'none',
      offerTitle: '[en] Blue Lagoon boat trip',
    });

    // Another space of the same Stay sees nothing of these.
    const other = await enterSpace(t, seed);
    expect((await get(t.app, '/api/orders', other.cookie)).json()).toEqual({ orders: [] });

    t.clock.advance(space.space.closedAt.getTime() - t.clock.now().getTime() + 60_000);
    const after = await get(t.app, '/api/orders', cookie);
    expect(after.statusCode).toBe(200);
    expect((after.json() as { orders: unknown[] }).orders).toHaveLength(2);
  });
});
