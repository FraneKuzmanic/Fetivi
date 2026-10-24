import {
  createOrder,
  orderProposals,
  orders,
  providerAccept,
  providerPropose,
  type ResolvedSpace,
} from '@fetivi/domain';
import { noopQueue, seedGuestUnit, seedOrderableOffer, seedProvider } from '@fetivi/domain/testing';
import { MockLanguageModelV4 } from 'ai/test';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ChatTestApp, createChatTestApp, enterSpace, write } from '../testing';

// After checkout My trip answers unresolved Orders by calling cancel_order and
// respond_to_order_update directly, without a model, on both transports.

const LINK = { trigger: 'provider_link' } as const;

const plusDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

interface Card {
  requestState: string;
  cancelOrder: { orderId: string } | null;
  respondOrder: { orderId: string } | null;
}

describe.each(['mcp', 'inprocess'] as const)('My trip order actions (%s)', (transport) => {
  let t: ChatTestApp;
  // Any call to the model fails the test: there are no steps to stream.
  const model = new MockLanguageModelV4({ doStream: [] as never });

  beforeAll(async () => {
    t = await createChatTestApp({ model, transport });
  });

  afterAll(async () => {
    // Read-only mode never reaches the model.
    expect(model.doStreamCalls).toHaveLength(0);
    await t?.close();
  });

  const deps = () => ({ db: t.db, queue: noopQueue, now: t.clock.now });

  /** A fresh Stay and its Space, entered by PIN. */
  async function stay() {
    const seed = await seedGuestUnit(t.db, { now: t.clock.now(), checkInInDays: 2 });
    const entered = await enterSpace(t, seed);
    return { ...entered, day: plusDays(seed.stay.checkIn, 1), seed };
  }

  /** A pay-direct on-request Order: `pending_provider` until the Provider answers. */
  async function pendingOrder(space: ResolvedSpace, day: string) {
    const provider = await seedProvider(t.db);
    const { offerId } = await seedOrderableOffer(t.db, {
      providerId: provider.id,
      availabilityMode: 'on_request',
    });
    const { order } = await createOrder(deps(), {
      spaceId: space.space.id,
      offerId,
      date: day,
      quantity: 2,
      contact: { email: 'guest@example.test' },
    });
    return order;
  }

  const afterCheckout = (space: ResolvedSpace) =>
    t.clock.advance(Math.max(0, space.space.closedAt.getTime() - t.clock.now().getTime()) + 60_000);

  const post = (url: string, body: unknown, cookie?: string) =>
    write('POST', t.app, url, body, { cookie });

  const statusOf = async (orderId: string) =>
    (await t.db.select().from(orders).where(eq(orders.id, orderId)))[0]?.status;

  it('needs a space', async () => {
    const response = await post(`/api/orders/${crypto.randomUUID()}/cancel`, {});
    expect([response.statusCode, response.json()]).toEqual([401, { error: 'no-space' }]);
  });

  it('cancels an Order still waiting for the Provider after checkout', async () => {
    const { cookie, space, day } = await stay();
    const order = await pendingOrder(space, day);
    expect(order.status).toBe('pending_provider');
    afterCheckout(space);

    const asked = await post(`/api/orders/${order.id}/cancel`, {}, cookie);
    expect(asked.statusCode).toBe(200);
    const { card } = asked.json() as { card: Card };
    expect(card).toMatchObject({ cancelOrder: { orderId: order.id }, respondOrder: null });

    const done = await post(
      `/api/orders/${order.id}/answer`,
      { toolName: 'cancel_order', requestState: card.requestState, action: 'accept', content: {} },
      cookie,
    );
    expect(done.statusCode).toBe(200);
    expect(done.json()).toMatchObject({
      outcome: 'cancelled',
      order: { id: order.id, status: 'cancelled' },
    });
    expect(await statusOf(order.id)).toBe('cancelled');
  });

  it('closes the card on Not now and changes nothing', async () => {
    const { cookie, space, day } = await stay();
    const order = await pendingOrder(space, day);
    afterCheckout(space);
    const { card } = (await post(`/api/orders/${order.id}/cancel`, {}, cookie)).json() as {
      card: Card;
    };
    const kept = await post(
      `/api/orders/${order.id}/answer`,
      { toolName: 'cancel_order', requestState: card.requestState, action: 'cancel' },
      cookie,
    );
    expect(kept.json()).toEqual({ outcome: 'not_cancelled', order: null });
    expect(await statusOf(order.id)).toBe('pending_provider');
  });

  it('refuses to cancel a confirmed Order after checkout', async () => {
    const { cookie, space, day } = await stay();
    const order = await pendingOrder(space, day);
    await providerAccept(
      deps(),
      { orderId: order.id, proposalId: order.currentProposalId ?? '' },
      LINK,
    );
    expect(await statusOf(order.id)).toBe('confirmed');
    afterCheckout(space);

    const refused = await post(`/api/orders/${order.id}/cancel`, {}, cookie);
    expect([refused.statusCode, refused.json()]).toEqual([409, { error: 'action-refused' }]);
    expect(await statusOf(order.id)).toBe('confirmed');
  });

  it("answers a Provider's new time after checkout", async () => {
    const { cookie, space, day } = await stay();
    const order = await pendingOrder(space, day);
    const proposed = await providerPropose(
      deps(),
      { orderId: order.id, proposalId: order.currentProposalId ?? '' },
      { date: day, time: '10:00' },
      LINK,
    );
    expect(proposed.outcome).toBe('applied');
    // The card normally ends at the new start, inside the stay; keep it open past checkout so
    // the after-checkout path is the one under test.
    const [current] = await t.db.select().from(orders).where(eq(orders.id, order.id));
    await t.db
      .update(orderProposals)
      .set({ cardExpiresAt: new Date(space.space.closedAt.getTime() + 86_400_000) })
      .where(eq(orderProposals.id, current?.currentProposalId ?? ''));
    afterCheckout(space);

    const asked = await post(`/api/orders/${order.id}/respond`, {}, cookie);
    expect(asked.statusCode).toBe(200);
    const { card } = asked.json() as { card: Card };
    expect(card).toMatchObject({ respondOrder: { orderId: order.id }, cancelOrder: null });

    const done = await post(
      `/api/orders/${order.id}/answer`,
      {
        toolName: 'respond_to_order_update',
        requestState: card.requestState,
        action: 'accept',
        content: { answer: 'accept' },
      },
      cookie,
    );
    expect(done.statusCode).toBe(200);
    expect(done.json()).toMatchObject({ outcome: 'accepted', order: { id: order.id } });
  });

  it("refuses another space's Order and a tampered state, changing nothing", async () => {
    const { cookie, space, day, seed } = await stay();
    const order = await pendingOrder(space, day);
    const other = await enterSpace(t, seed);
    afterCheckout(space);

    const foreign = await post(`/api/orders/${order.id}/cancel`, {}, other.cookie);
    expect([foreign.statusCode, foreign.json()]).toEqual([409, { error: 'action-refused' }]);

    const { card } = (await post(`/api/orders/${order.id}/cancel`, {}, cookie)).json() as {
      card: Card;
    };
    const tampered = await post(
      `/api/orders/${order.id}/answer`,
      {
        toolName: 'cancel_order',
        requestState: `${card.requestState.slice(0, -4)}AAAA`,
        action: 'accept',
        content: {},
      },
      cookie,
    );
    expect([tampered.statusCode, tampered.json()]).toEqual([409, { error: 'action-refused' }]);
    // The real state from another space cannot be answered there either.
    const elsewhere = await post(
      `/api/orders/${order.id}/answer`,
      { toolName: 'cancel_order', requestState: card.requestState, action: 'accept', content: {} },
      other.cookie,
    );
    expect(elsewhere.statusCode).toBe(409);
    expect(await statusOf(order.id)).toBe('pending_provider');
  });

  it('validates the answer body', async () => {
    const { cookie, space, day } = await stay();
    const order = await pendingOrder(space, day);
    const bad = await post(
      `/api/orders/${order.id}/answer`,
      { toolName: 'create_order', requestState: 'x', action: 'accept' },
      cookie,
    );
    expect([bad.statusCode, bad.json()]).toEqual([400, { error: 'invalid-input' }]);
  });
});
