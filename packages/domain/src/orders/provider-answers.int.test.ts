import { eq, sql } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accounts } from '../db/schema/accounts';
import { orderEvents } from '../db/schema/orders';
import { createJobQueue, ensureQueues, type JobQueue, QUEUES } from '../jobs/queue';
import { createTestDatabase, type TestDatabase } from '../testing';
import {
  type SeededGuestUnit,
  seedGuestUnit,
  seedOrderableOffer,
  seedProvider,
} from '../testing/fixtures';
import { createOrder, getOrder, type OrderDeps, OrderRuleError } from './machine';
import {
  proposalCardExpiry,
  providerAccept,
  providerDecline,
  providerPropose,
} from './provider-answers';
import { orderJobId } from './timers';

let testDb: TestDatabase;
let boss: PgBoss;
let queue: JobQueue;
let unit: SeededGuestUnit;
let providerId: string;

const NOW = new Date('2027-05-01T10:00:00Z');
const DAY = '2027-05-04';
const SLOT_AT = new Date('2027-05-04T07:00:00Z');
const HOLD_UNTIL = new Date('2027-05-01T10:30:00Z');
const LINK = { trigger: 'provider_link' } as const;

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
  providerId = (await seedProvider(testDb.db)).id;
});

afterAll(async () => {
  await boss?.stop({ graceful: false, timeout: 1000 });
  await testDb?.drop();
});

async function pendingOrder(orderKind: 'booking' | 'request' = 'booking') {
  clock = NOW;
  const { offerId } = await seedOrderableOffer(testDb.db, {
    providerId,
    availabilityMode: 'on_request',
    orderKind,
  });
  const { order } = await createOrder(deps(), {
    spaceId: unit.spaceId,
    offerId,
    date: DAY,
    quantity: 2,
    contact: { email: 'guest@example.test' },
  });
  expect(order.status).toBe('pending_provider');
  const found = await getOrder(testDb.db, order.id);
  if (!found) throw new Error('no order');
  return { orderId: order.id, proposalId: found.proposal.id };
}

const events = (orderId: string) =>
  testDb.db
    .select()
    .from(orderEvents)
    .where(eq(orderEvents.orderId, orderId))
    .orderBy(orderEvents.id);

async function jobs(orderId: string, name: string) {
  const { rows } = await testDb.db.execute<{
    id: string;
    data: Record<string, string>;
    start_ms: number;
  }>(
    sql`select id, data, (extract(epoch from start_after) * 1000)::float8 as start_ms from pgboss.job where name = ${name} and data->>'orderId' = ${orderId} order by created_on, id`,
  );
  return rows;
}

const notifyKinds = async (orderId: string) =>
  (await jobs(orderId, QUEUES.orderNotify)).map((j) => j.data.kind);

describe('proposalCardExpiry', () => {
  it('gives the guest 24 hours, never past the new start', () => {
    expect(proposalCardExpiry(NOW, new Date('2027-05-04T07:00:00Z'))).toEqual(
      new Date('2027-05-02T10:00:00Z'),
    );
    const soon = new Date('2027-05-01T15:00:00Z');
    expect(proposalCardExpiry(NOW, soon)).toEqual(soon);
  });
});

describe('Provider answers', () => {
  it('accepts from the link: confirmed, recorded as provider_link', async () => {
    const ref = await pendingOrder();
    const result = await providerAccept(deps(), ref, LINK);
    expect(result).toMatchObject({ outcome: 'applied', order: { status: 'confirmed' } });
    expect((await events(ref.orderId)).at(-1)).toMatchObject({
      fromStatus: 'pending_provider',
      toStatus: 'confirmed',
      trigger: 'provider_link',
    });
  });

  it("records the admin's phoned answer with the actor and the note", async () => {
    const ref = await pendingOrder();
    const [admin] = await testDb.db
      .insert(accounts)
      .values({ email: `admin-${ref.orderId}@example.test`, passwordHash: 'x', role: 'admin' })
      .returning();
    if (!admin) throw new Error('no admin');
    const result = await providerAccept(deps(), ref, {
      trigger: 'admin',
      actorId: admin.id,
      note: 'Phoned: yes, 10:00 works',
    });
    expect(result.order.status).toBe('confirmed');
    expect((await events(ref.orderId)).at(-1)).toMatchObject({
      trigger: 'admin',
      actorId: admin.id,
      note: 'Phoned: yes, 10:00 works',
    });
  });

  it('declines: declined, and the guest is told', async () => {
    const ref = await pendingOrder();
    const result = await providerDecline(deps(), ref, LINK);
    expect(result.order.status).toBe('declined');
    expect(await notifyKinds(ref.orderId)).toEqual(['provider_request', 'order_declined']);
  });

  it('proposes another time: a new version the guest answers within the card window', async () => {
    const ref = await pendingOrder();
    const result = await providerPropose(deps(), ref, { date: '2027-05-05', time: '10:00' }, LINK);
    expect(result).toMatchObject({
      outcome: 'applied',
      order: { status: 'awaiting_confirmation', date: '2027-05-05', paymentStatus: 'none' },
    });
    const found = await getOrder(testDb.db, ref.orderId);
    const v2 = found?.proposal;
    expect(v2).toMatchObject({
      version: 2,
      proposer: 'provider_time',
      quantity: 2,
      startsAt: new Date('2027-05-05T08:00:00Z'),
      cardExpiresAt: new Date('2027-05-02T10:00:00Z'),
    });
    const card = (await jobs(ref.orderId, QUEUES.orderTimer)).find(
      (j) => j.data.operation === 'card_expiry',
    );
    expect(card?.id).toBe(orderJobId(ref.orderId, v2?.id ?? '', 'card_expiry'));
    expect(card?.start_ms).toBe(new Date('2027-05-02T10:00:00Z').getTime());
    expect((await notifyKinds(ref.orderId)).at(-1)).toBe('order_new_proposal');
  });

  it('ignores a tap on a page for an older proposal, writing nothing', async () => {
    const ref = await pendingOrder();
    await providerPropose(deps(), ref, { date: '2027-05-05' }, LINK);
    const before = (await events(ref.orderId)).length;
    const notified = (await notifyKinds(ref.orderId)).length;
    for (const answer of [
      providerAccept(deps(), ref, LINK),
      providerDecline(deps(), ref, LINK),
      providerPropose(deps(), ref, { date: '2027-05-04' }, LINK),
    ]) {
      expect((await answer).outcome).toBe('stale');
    }
    expect(await events(ref.orderId)).toHaveLength(before);
    expect(await notifyKinds(ref.orderId)).toHaveLength(notified);
    expect((await getOrder(testDb.db, ref.orderId))?.proposal.version).toBe(2);
  });

  it('refuses a start that has passed, a bad time and a date outside the stay', async () => {
    const ref = await pendingOrder();
    clock = new Date('2027-05-04T12:00:00Z');
    await expect(
      providerPropose(deps(), ref, { date: '2027-05-04', time: '09:00' }, LINK),
    ).rejects.toEqual(new OrderRuleError('invalid-input'));
    await expect(
      providerPropose(deps(), ref, { date: '2027-05-05', time: '25:00' }, LINK),
    ).rejects.toEqual(new OrderRuleError('invalid-input'));
    await expect(
      providerPropose(deps(), ref, { date: '2027-05-05', priceMinor: 0 }, LINK),
    ).rejects.toEqual(new OrderRuleError('invalid-input'));
    await expect(providerPropose(deps(), ref, { date: '2027-05-09' }, LINK)).rejects.toEqual(
      new OrderRuleError('date-outside-stay'),
    );
    clock = NOW;
  });

  it('needs a price for a request-kind Offer: no plain Accept', async () => {
    const ref = await pendingOrder('request');
    expect((await providerAccept(deps(), ref, LINK)).outcome).toBe('rejected');
    await expect(providerPropose(deps(), ref, { date: '2027-05-05' }, LINK)).rejects.toEqual(
      new OrderRuleError('invalid-input'),
    );
    const priced = await providerPropose(deps(), ref, { date: DAY, priceMinor: 18000 }, LINK);
    expect(priced.order.status).toBe('awaiting_confirmation');
    expect((await getOrder(testDb.db, ref.orderId))?.proposal).toMatchObject({
      version: 2,
      proposer: 'provider_price',
      priceMinor: 18000,
    });
  });

  it('answers only on-request Orders', async () => {
    clock = NOW;
    const { offerId, slotId } = await seedOrderableOffer(testDb.db, {
      providerId,
      availabilityMode: 'allotment',
      startsAt: SLOT_AT,
    });
    const { order } = await createOrder(deps(), {
      spaceId: unit.spaceId,
      offerId,
      slotId,
      date: DAY,
      quantity: 1,
      contact: { email: 'guest@example.test' },
      hold: { expiresAt: HOLD_UNTIL },
    });
    const ref = { orderId: order.id, proposalId: order.currentProposalId ?? '' };
    expect((await providerAccept(deps(), ref, LINK)).outcome).toBe('rejected');
    expect((await providerDecline(deps(), ref, LINK)).outcome).toBe('rejected');
  });
});
