import {
  accounts,
  confirmHeldOrder,
  createJobQueue,
  createOrder,
  type OrderDeps,
  orderEvents,
  orderProposals,
  orders,
  properties,
} from '@fetivi/domain';
import {
  type SeededGuestUnit,
  seedGuestUnit,
  seedOrderableOffer,
  seedProvider,
} from '@fetivi/domain/testing';
import { desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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

let t: TestApp;
let hostA: { id: string; cookie: string };
let hostB: { id: string; cookie: string };
let adminCookie: string;
let guest: SeededGuestUnit;

// The clock starts at 2026-10-19T10:00Z; the seeded stay runs 2026-10-21 to 2026-10-24.
const DAY = '2026-10-22';
const SLOT_AT = new Date('2026-10-22T07:00:00Z'); // 09:00 in Zagreb
const CONTACT = { email: 'ana@example.test', name: 'Ana Horvat', phone: '+385 91 000 0000' };

const orderDeps = (): OrderDeps => ({ db: t.db, queue: createJobQueue(t.boss), now: t.clock.now });

async function host(email: string) {
  await signUpVerifiedHost(t, email);
  const [row] = await t.db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.email, email));
  if (!row) throw new Error(`no account ${email}`);
  return { id: row.id, cookie: await loginAs(t, email) };
}

/** A pending_provider Order on one of host A's own on-request Offers. */
async function askedOrder(orderKind: 'booking' | 'request' = 'booking') {
  const { offerId } = await seedOrderableOffer(t.db, {
    hostId: hostA.id,
    availabilityMode: 'on_request',
    orderKind,
    contactFields: 'name',
    title: 'Airport transfer',
  });
  const { order } = await createOrder(orderDeps(), {
    spaceId: guest.spaceId,
    offerId,
    date: DAY,
    quantity: 2,
    contact: CONTACT,
  });
  return { orderId: order.id, proposalId: order.currentProposalId as string };
}

/** A confirmed allotment Order on one of host A's own Offers. */
async function confirmedOrder() {
  const { offerId, slotId } = await seedOrderableOffer(t.db, {
    hostId: hostA.id,
    availabilityMode: 'allotment',
    startsAt: SLOT_AT,
    title: 'Fig jam',
  });
  const { order } = await createOrder(orderDeps(), {
    spaceId: guest.spaceId,
    offerId,
    slotId,
    date: DAY,
    quantity: 1,
    contact: CONTACT,
    hold: { expiresAt: new Date(t.clock.now().getTime() + 30 * 60_000) },
  });
  const ref = { orderId: order.id, proposalId: order.currentProposalId as string };
  await confirmHeldOrder(orderDeps(), ref);
  return ref;
}

const act = (orderId: string, body: Record<string, unknown>, cookie = hostA.cookie) =>
  post(t.app, `/api/host/orders/${orderId}/actions`, body, cookie);

async function lastEvent(orderId: string) {
  const [event] = await t.db
    .select()
    .from(orderEvents)
    .where(eq(orderEvents.orderId, orderId))
    .orderBy(desc(orderEvents.createdAt), desc(orderEvents.id))
    .limit(1);
  return event;
}

const statusOf = async (orderId: string) =>
  (await t.db.select().from(orders).where(eq(orders.id, orderId)))[0]?.status;

beforeAll(async () => {
  t = await createTestApp();
  const created = await createAdmin(t.db, 'admin@example.test', PASSWORD);
  if (!created.ok) throw new Error('admin not created');
  adminCookie = await loginAs(t, 'admin@example.test');
  hostA = await host('a@example.test');
  hostB = await host('b@example.test');
  guest = await seedGuestUnit(t.db, { now: t.clock.now() });
  await t.db
    .update(properties)
    .set({ hostId: hostA.id })
    .where(eq(properties.id, guest.propertyId));
});

afterAll(async () => {
  await t?.close();
});

describe('host orders', () => {
  it("opens the host's own Order, and 404s another host's and a Provider's", async () => {
    const ref = await askedOrder();
    const mine = await get(t.app, `/api/host/orders/${ref.orderId}`, hostA.cookie);
    expect(mine.statusCode).toBe(200);
    expect(mine.json().order).toMatchObject({
      orderId: ref.orderId,
      proposalId: ref.proposalId,
      offerTitle: 'Airport transfer',
      status: 'pending_provider',
      actions: ['accept', 'suggest_time', 'decline'],
      guest: { name: 'Ana Horvat' },
    });
    expect(JSON.stringify(mine.json())).not.toContain('ana@example.test');
    expect((await get(t.app, `/api/host/orders/${ref.orderId}`, hostB.cookie)).statusCode).toBe(
      404,
    );
    expect(
      (await act(ref.orderId, { action: 'accept', proposalId: ref.proposalId }, hostB.cookie))
        .statusCode,
    ).toBe(404);

    const provider = await seedProvider(t.db);
    const { offerId } = await seedOrderableOffer(t.db, {
      providerId: provider.id,
      availabilityMode: 'on_request',
    });
    const { order } = await createOrder(orderDeps(), {
      spaceId: guest.spaceId,
      offerId,
      date: DAY,
      quantity: 1,
      contact: CONTACT,
    });
    expect((await get(t.app, `/api/host/orders/${order.id}`, hostA.cookie)).statusCode).toBe(404);
  });

  it('Accept confirms, recorded as provider_link with the host as actor; the inbox count drops', async () => {
    const ref = await askedOrder();
    const before = (await get(t.app, '/api/host/inbox', hostA.cookie)).json();
    expect(before.orders.find((o: { orderId: string }) => o.orderId === ref.orderId)).toMatchObject(
      { waiting: true },
    );
    const response = await act(ref.orderId, { action: 'accept', proposalId: ref.proposalId });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      outcome: 'applied',
      order: { status: 'confirmed', actions: [] },
    });
    expect(await lastEvent(ref.orderId)).toMatchObject({
      trigger: 'provider_link',
      actorId: hostA.id,
      toStatus: 'confirmed',
    });
    const after = (await get(t.app, '/api/host/inbox', hostA.cookie)).json();
    expect(after.ordersWaiting).toBe(before.ordersWaiting - 1);
    expect(after.unread).toBe(before.unread);
  });

  it('Decline declines', async () => {
    const ref = await askedOrder();
    const response = await act(ref.orderId, { action: 'decline', proposalId: ref.proposalId });
    expect(response.json().outcome).toBe('applied');
    expect(await statusOf(ref.orderId)).toBe('declined');
    expect(await lastEvent(ref.orderId)).toMatchObject({
      trigger: 'provider_link',
      actorId: hostA.id,
    });
  });

  it('Suggest another time proposes new terms for the guest', async () => {
    const ref = await askedOrder();
    const response = await act(ref.orderId, {
      action: 'suggest_time',
      proposalId: ref.proposalId,
      date: '2026-10-23',
      time: '10:30',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      outcome: 'applied',
      order: { status: 'awaiting_confirmation', date: '2026-10-23', startTime: '10:30' },
    });
    expect(response.json().order.proposalId).not.toBe(ref.proposalId);
    expect(await lastEvent(ref.orderId)).toMatchObject({ actorId: hostA.id });
  });

  it('refuses new terms outside the stay or with a bad time', async () => {
    const ref = await askedOrder();
    const base = { action: 'suggest_time', proposalId: ref.proposalId };
    expect((await act(ref.orderId, { ...base, date: '2026-11-30' })).statusCode).toBe(400);
    expect((await act(ref.orderId, { ...base, date: DAY, time: '25:00' })).statusCode).toBe(400);
    expect((await act(ref.orderId, { ...base, date: DAY, extra: 1 })).statusCode).toBe(400);
    expect(await statusOf(ref.orderId)).toBe('pending_provider');
  });

  it('Accept with price names the price of a request-kind Order', async () => {
    const ref = await askedOrder('request');
    const view = (await get(t.app, `/api/host/orders/${ref.orderId}`, hostA.cookie)).json().order;
    expect(view.actions).toEqual(['accept_with_price', 'suggest_time', 'decline']);
    const base = { action: 'accept_with_price', proposalId: ref.proposalId };
    expect((await act(ref.orderId, base)).statusCode).toBe(400);
    const response = await act(ref.orderId, { ...base, priceMinor: 8_000 });
    expect(response.json()).toMatchObject({
      outcome: 'applied',
      order: { status: 'awaiting_confirmation', priceMinor: 8_000, date: DAY },
    });
  });

  it('Got it and Can’t fulfil on a confirmed allotment Order', async () => {
    const ref = await confirmedOrder();
    const got = await act(ref.orderId, { action: 'acknowledge', proposalId: ref.proposalId });
    expect(got.json()).toMatchObject({ outcome: 'applied', order: { actions: ['cannot_fulfil'] } });
    const [proposal] = await t.db
      .select()
      .from(orderProposals)
      .where(eq(orderProposals.id, ref.proposalId));
    expect(proposal?.providerAcknowledgedAt).not.toBeNull();
    const cancelled = await act(ref.orderId, {
      action: 'cannot_fulfil',
      proposalId: ref.proposalId,
    });
    expect(cancelled.json()).toMatchObject({ outcome: 'applied', order: { status: 'cancelled' } });
    expect(await lastEvent(ref.orderId)).toMatchObject({
      trigger: 'provider_link',
      actorId: hostA.id,
      toStatus: 'cancelled',
    });
  });

  it('a stale proposal or an action not on offer writes nothing', async () => {
    const ref = await askedOrder();
    const stale = await act(ref.orderId, {
      action: 'accept',
      proposalId: '00000000-0000-4000-8000-000000000000',
    });
    expect(stale.json().outcome).toBe('stale');
    const rejected = await act(ref.orderId, { action: 'acknowledge', proposalId: ref.proposalId });
    expect(rejected.json().outcome).toBe('rejected');
    expect(await statusOf(ref.orderId)).toBe('pending_provider');
  });

  it('an admin acting as the host can answer, as the actor, audited', async () => {
    const ref = await askedOrder();
    const [admin] = await t.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.email, 'admin@example.test'));
    await post(t.app, '/api/admin/act-as', { hostId: hostA.id }, adminCookie);
    try {
      const response = await act(
        ref.orderId,
        { action: 'accept', proposalId: ref.proposalId },
        adminCookie,
      );
      expect(response.json().outcome).toBe('applied');
    } finally {
      await post(t.app, '/api/admin/act-as/stop', undefined, adminCookie);
    }
    expect(await lastEvent(ref.orderId)).toMatchObject({ actorId: admin?.id });
    await vi.waitFor(async () => {
      const audit = await get(t.app, '/api/admin/audit', adminCookie);
      expect(audit.json().entries.map((e: { route: string }) => e.route)).toContain(
        '/api/host/orders/:id/actions',
      );
    });
  });
});
