import { eq } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { orders } from '../db/schema/orders';
import { createJobQueue, ensureQueues, type JobQueue } from '../jobs/queue';
import { createOrder, type OrderDeps } from '../orders/machine';
import { createTestDatabase, type TestDatabase } from '../testing';
import {
  type SeededGuestUnit,
  seedGuestUnit,
  seedOrderableOffer,
  seedProvider,
} from '../testing/fixtures';
import { confirmHeldOrder } from './adapters';
import { findHostOrder, hostOrdersWaiting, listHostOrders } from './host-orders';
import { acknowledgeOrder, declineOrder } from './provider-link/link';

let testDb: TestDatabase;
let boss: PgBoss;
let queue: JobQueue;
let unit: SeededGuestUnit;
let neighbour: SeededGuestUnit;

const NOW = new Date('2027-05-01T10:00:00Z');
const DAY = '2027-05-04';
const SLOT_AT = new Date('2027-05-04T07:00:00Z'); // 09:00 in Zagreb
const HOLD_UNTIL = new Date('2027-05-01T10:30:00Z');
const CONTACT = { email: 'guest@example.test', name: 'Ana', phone: '+385 91 000 0000' };

let clock = NOW;
const deps = (): OrderDeps => ({ db: testDb.db, queue, now: () => clock });

beforeAll(async () => {
  testDb = await createTestDatabase();
  boss = new PgBoss({ connectionString: testDb.url, supervise: false, schedule: false });
  boss.on('error', console.error);
  await boss.start();
  await ensureQueues(boss);
  queue = createJobQueue(boss);
  unit = await seedGuestUnit(testDb.db, { now: NOW });
  neighbour = await seedGuestUnit(testDb.db, { now: NOW });
});

afterAll(async () => {
  await boss?.stop({ graceful: false, timeout: 1000 });
  await testDb?.drop();
});

/** A pending_provider Order on an own on-request Offer of `guest`'s host. */
async function askedOrder(guest = unit, title = 'Transfer') {
  const { offerId } = await seedOrderableOffer(testDb.db, {
    hostId: guest.hostId,
    availabilityMode: 'on_request',
    contactFields: 'name',
    title,
  });
  const { order } = await createOrder(deps(), {
    spaceId: guest.spaceId,
    offerId,
    date: DAY,
    quantity: 2,
    contact: CONTACT,
  });
  return { orderId: order.id, proposalId: order.currentProposalId as string };
}

/** An allotment Order on an own Offer, held (the guest's tap) and optionally confirmed. */
async function allotmentOrder(confirmed: boolean) {
  const { offerId, slotId } = await seedOrderableOffer(testDb.db, {
    hostId: unit.hostId,
    availabilityMode: 'allotment',
    startsAt: SLOT_AT,
    title: 'Jam',
  });
  const { order } = await createOrder(deps(), {
    spaceId: unit.spaceId,
    offerId,
    slotId,
    date: DAY,
    quantity: 1,
    contact: CONTACT,
    hold: { expiresAt: HOLD_UNTIL },
  });
  const ref = { orderId: order.id, proposalId: order.currentProposalId as string };
  if (confirmed) await confirmHeldOrder(deps(), ref);
  return ref;
}

describe('findHostOrder', () => {
  it("opens the host's own Order with the Provider view, and nobody else's", async () => {
    const ref = await askedOrder();
    const found = await findHostOrder(testDb.db, unit.hostId, ref.orderId);
    expect(found?.order.id).toBe(ref.orderId);
    expect(await findHostOrder(testDb.db, neighbour.hostId, ref.orderId)).toBeUndefined();
    expect(await findHostOrder(testDb.db, unit.hostId, 'not-a-uuid')).toBeUndefined();

    const provider = await seedProvider(testDb.db);
    const { offerId } = await seedOrderableOffer(testDb.db, {
      providerId: provider.id,
      availabilityMode: 'on_request',
    });
    const { order } = await createOrder(deps(), {
      spaceId: unit.spaceId,
      offerId,
      date: DAY,
      quantity: 1,
      contact: CONTACT,
    });
    expect(await findHostOrder(testDb.db, unit.hostId, order.id)).toBeUndefined();
  });
});

describe('listHostOrders and hostOrdersWaiting', () => {
  it('lists newest first, hides the first tap and old final Orders, and counts what waits', async () => {
    const host = await seedGuestUnit(testDb.db, { now: NOW });
    const base = await hostOrdersWaiting(testDb.db, unit.hostId);

    clock = new Date(NOW.getTime() - 3 * 60_000);
    const asked = await askedOrder(unit, 'Asked');
    clock = new Date(NOW.getTime() - 2 * 60_000);
    const held = await allotmentOrder(false);
    clock = new Date(NOW.getTime() - 60_000);
    const confirmed = await allotmentOrder(true);
    clock = NOW;
    const declined = await askedOrder(unit, 'Declined');
    await declineOrder(deps(), declined);
    const old = await askedOrder(unit, 'Old');
    await declineOrder(deps(), old);
    await testDb.db
      .update(orders)
      .set({ updatedAt: new Date(NOW.getTime() - 31 * 24 * 60 * 60_000) })
      .where(eq(orders.id, old.orderId));
    await askedOrder(host, 'Elsewhere');

    const list = await listHostOrders(testDb.db, unit.hostId, NOW);
    const ids = list.map((o) => o.orderId);
    expect(ids).not.toContain(held.orderId);
    expect(ids).not.toContain(old.orderId);
    expect(ids.indexOf(declined.orderId)).toBeLessThan(ids.indexOf(confirmed.orderId));
    expect(ids.indexOf(confirmed.orderId)).toBeLessThan(ids.indexOf(asked.orderId));
    expect(list.every((o) => o.offerTitle !== 'Elsewhere')).toBe(true);

    const byId = (id: string) => list.find((o) => o.orderId === id);
    expect(byId(asked.orderId)).toMatchObject({
      waiting: true,
      actions: ['accept', 'suggest_time', 'decline'],
      guest: { name: 'Ana' },
    });
    expect(byId(asked.orderId)).not.toHaveProperty('guestEmail');
    expect(byId(confirmed.orderId)).toMatchObject({
      waiting: true,
      actions: ['acknowledge', 'cannot_fulfil'],
    });
    expect(byId(declined.orderId)).toMatchObject({ waiting: false, final: true, guest: {} });

    expect(await hostOrdersWaiting(testDb.db, unit.hostId)).toBe(base + 2);
    await acknowledgeOrder(deps(), confirmed);
    expect(await hostOrdersWaiting(testDb.db, unit.hostId)).toBe(base + 1);
    expect(
      (await listHostOrders(testDb.db, unit.hostId, NOW)).find(
        (o) => o.orderId === confirmed.orderId,
      ),
    ).toMatchObject({ waiting: false, actions: ['cannot_fulfil'] });
  });
});
