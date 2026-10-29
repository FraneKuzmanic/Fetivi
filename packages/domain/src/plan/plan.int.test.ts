import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedTrogir } from '../catalog/seed/trogir';
import { createCatalogRecord } from '../catalog/store';
import { catalogRecords } from '../db/schema/catalog';
import { planItems } from '../db/schema/plan';
import { spaces } from '../db/schema/spaces';
import { cancel, getOrder } from '../orders/machine';
import { completeOrder, prepareOrder } from '../services/pending/create-order';
import { loadSituation } from '../situation/load';
import {
  createTestDatabase,
  noopQueue,
  publishCatalog,
  publishOffer,
  seedGuestUnit,
  seedOrderableOffer,
  seedProvider,
  type TestDatabase,
} from '../testing';
import { fromLocalDateTime } from '../time';
import { getPlan, type PlanContext, PlanRuleError, updatePlan } from './store';

const NOW = new Date('2027-07-10T08:00:00Z');

let testDb: TestDatabase;
let destinationId: string;
let placeId: string;
let unpublishedPlaceId: string;

const plusDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  testDb = await createTestDatabase();
  const db = testDb.db;
  ({ destinationId } = await seedTrogir(db, noopQueue, NOW));
  await publishCatalog(db, destinationId);
  const [place] = await db
    .select({ id: catalogRecords.id })
    .from(catalogRecords)
    .where(and(eq(catalogRecords.destinationId, destinationId), eq(catalogRecords.kind, 'place')));
  if (!place) throw new Error('no place seeded');
  placeId = place.id;
  const hidden = await createCatalogRecord(
    db,
    noopQueue,
    {
      destinationId,
      kind: 'place',
      placeCategory: 'beach',
      title: 'Hidden cove',
      description: 'A secret beach.',
      location: { x: 16.25, y: 43.51 },
    },
    NOW,
  );
  unpublishedPlaceId = hidden.id;
});

afterAll(async () => {
  await testDb?.drop();
});

async function contextOf(spaceId: string): Promise<PlanContext> {
  const ctx = await loadSituation(testDb.db, spaceId, NOW);
  if (!ctx) throw new Error('no space');
  return {
    spaceId,
    language: ctx.language,
    offerScope: {
      destinationId: ctx.destinationId,
      propertyId: ctx.propertyId,
      language: ctx.language,
    },
  };
}

async function newSpace() {
  const seed = await seedGuestUnit(testDb.db, { now: NOW, nights: 3 });
  return { seed, ctx: await contextOf(seed.spaceId) };
}

/** Thrown PlanRuleError code, or null when the call succeeded. */
async function codeOf(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    if (error instanceof PlanRuleError) return error.code;
    throw error;
  }
}

async function storedCount(spaceId: string) {
  return (await testDb.db.select().from(planItems).where(eq(planItems.spaceId, spaceId))).length;
}

/** A confirmed Order at 09:00 on `day`, made through both halves as create_order makes it. */
async function placeOrder(ctx: PlanContext, day: string) {
  const db = testDb.db;
  const provider = await seedProvider(db);
  const boat = await seedOrderableOffer(db, {
    providerId: provider.id,
    destinationId,
    availabilityMode: 'allotment',
    startsAt: fromLocalDateTime(`${day}T09:00`, 'Europe/Zagreb'),
    capacity: 10,
    title: 'Blue Lagoon boat trip',
  });
  await publishOffer(db, boat.offerId);
  const deps = { db, queue: noopQueue, now: () => NOW };
  const { pendingId } = await prepareOrder(
    deps,
    { spaceId: ctx.spaceId, offerScope: ctx.offerScope },
    { offerId: boat.offerId, date: day, quantity: 2 },
  );
  const { order } = await completeOrder(deps, {
    pendingId,
    spaceId: ctx.spaceId,
    offerScope: ctx.offerScope,
    contact: { email: 'guest@example.test', name: 'Ana' },
    details: { note: null, time: null },
  });
  return { order, offerId: boat.offerId };
}

describe('getPlan', () => {
  it('lists every Stay day from check-in to checkout, with today in the property zone', async () => {
    const { seed, ctx } = await newSpace();
    const plan = await getPlan(testDb.db, ctx, NOW);
    expect(plan.checkIn).toBe(seed.stay.checkIn);
    expect(plan.checkout).toBe(seed.stay.checkout);
    expect(plan.days.map((d) => d.date)).toEqual(
      [0, 1, 2, 3].map((i) => plusDays(seed.stay.checkIn, i)),
    );
    expect(plan.days.every((d) => d.items.length === 0)).toBe(true);
    // 2027-07-10T23:30Z is already the 11th in Zagreb.
    const late = await getPlan(testDb.db, ctx, new Date('2027-07-10T23:30:00Z'));
    expect([plan.today, late.today]).toEqual(['2027-07-10', '2027-07-11']);
  });

  it('shows a confirmed Order on its day by itself, and drops it when cancelled', async () => {
    const { seed, ctx } = await newSpace();
    const day = plusDays(seed.stay.checkIn, 1);
    const { order, offerId } = await placeOrder(ctx, day);
    expect(order.status).toBe('confirmed');

    const plan = await getPlan(testDb.db, ctx, NOW, { date: day });
    expect(plan.days).toEqual([
      {
        date: day,
        items: [
          {
            id: order.id,
            kind: 'order',
            date: day,
            time: '09:00',
            title: '[en] Blue Lagoon boat trip',
            note: null,
            placeId: null,
            offerId,
            orderId: order.id,
            orderStatus: 'confirmed',
          },
        ],
      },
    ]);

    const current = await getOrder(testDb.db, order.id);
    if (!current) throw new Error('no order');
    await cancel(
      { db: testDb.db, queue: noopQueue, now: () => NOW },
      { orderId: order.id, proposalId: current.proposal.id, trigger: 'provider_link' },
    );
    const after = await getPlan(testDb.db, ctx, NOW, { date: day });
    expect(after.days[0]?.items).toEqual([]);
  });

  it('refuses a date outside the Stay or a malformed one', async () => {
    const { seed, ctx } = await newSpace();
    expect(
      await codeOf(() => getPlan(testDb.db, ctx, NOW, { date: plusDays(seed.stay.checkIn, -1) })),
    ).toBe('date-outside-stay');
    expect(await codeOf(() => getPlan(testDb.db, ctx, NOW, { date: '2027-02-30' }))).toBe(
      'invalid-input',
    );
  });
});

describe('updatePlan', () => {
  it('adds, moves and removes suggestions, timed items before any-time ones', async () => {
    const { seed, ctx } = await newSpace();
    const db = testDb.db;
    const first = seed.stay.checkIn;
    const second = plusDays(first, 1);

    const added = await updatePlan(
      db,
      ctx,
      {
        add: [
          { date: first, title: '  Dinner in the old town  ', note: '' },
          { date: first, time: '10:00', title: 'Morning swim', placeId },
          { date: first, time: '08:30', title: 'Breakfast\nat the market' },
        ],
      },
      NOW,
    );
    expect(added.days.map((d) => d.date)).toEqual([first]);
    expect(added.days[0]?.items.map((i) => [i.time, i.title, i.note])).toEqual([
      ['08:30', 'Breakfast at the market', null],
      ['10:00', 'Morning swim', null],
      [null, 'Dinner in the old town', null],
    ]);
    expect(added.days[0]?.items[1]).toMatchObject({ kind: 'suggestion', placeId, orderId: null });

    const swim = added.days[0]?.items[1];
    if (!swim) throw new Error('no item');
    const moved = await updatePlan(
      db,
      ctx,
      { update: [{ itemId: swim.id, date: second, time: null, note: 'Bring snorkels' }] },
      NOW,
    );
    expect(moved.days.map((d) => d.date)).toEqual([first, second]);
    expect(moved.days[1]?.items).toEqual([
      expect.objectContaining({
        id: swim.id,
        time: null,
        title: 'Morning swim',
        note: 'Bring snorkels',
      }),
    ]);

    const removed = await updatePlan(db, ctx, { remove: [swim.id] }, NOW);
    expect(removed.days).toEqual([{ date: second, items: [] }]);
    expect(await storedCount(ctx.spaceId)).toBe(2);
  });

  it('rejects an item for a date outside the Stay, and stores nothing of that call', async () => {
    const { seed, ctx } = await newSpace();
    const db = testDb.db;
    for (const date of [plusDays(seed.stay.checkIn, -1), plusDays(seed.stay.checkout, 1)]) {
      expect(
        await codeOf(() =>
          updatePlan(
            db,
            ctx,
            {
              add: [
                { date: seed.stay.checkIn, title: 'Fine' },
                { date, title: 'Too late' },
              ],
            },
            NOW,
          ),
        ),
      ).toBe('date-outside-stay');
    }
    expect(await storedCount(ctx.spaceId)).toBe(0);
    // Past days inside the Stay are fine.
    const later = new Date('2027-07-20T08:00:00Z');
    await updatePlan(db, ctx, { add: [{ date: seed.stay.checkIn, title: 'Kept' }] }, later);
    expect(await storedCount(ctx.spaceId)).toBe(1);
  });

  it('refuses invalid input', async () => {
    const { seed, ctx } = await newSpace();
    const db = testDb.db;
    const date = seed.stay.checkIn;
    const cases = [
      { add: [{ date, title: 'Swim', time: '25:00' }] },
      { add: [{ date, title: '   ' }] },
      { add: [{ date, title: 'x'.repeat(81) }] },
      { add: [{ date, title: 'Swim', note: 'x'.repeat(281) }] },
      { add: [{ date: '2027-7-1', title: 'Swim' }] },
      {},
      { remove: Array.from({ length: 21 }, () => randomUUID()) },
    ];
    for (const input of cases) {
      expect(await codeOf(() => updatePlan(db, ctx, input, NOW))).toBe('invalid-input');
    }
    expect(await storedCount(ctx.spaceId)).toBe(0);
  });

  it('keeps items private to the Space, even within the same Stay', async () => {
    const { seed, ctx } = await newSpace();
    const db = testDb.db;
    const plan = await updatePlan(
      db,
      ctx,
      { add: [{ date: seed.stay.checkIn, title: 'Ours' }] },
      NOW,
    );
    const itemId = plan.days[0]?.items[0]?.id;
    if (!itemId) throw new Error('no item');

    const [other] = await db
      .insert(spaces)
      .values({
        stayId: seed.stayId,
        tokenHash: randomUUID(),
        language: 'en',
        closedAt: seed.stay.activeUntil,
        createdAt: NOW,
        updatedAt: NOW,
      })
      .returning();
    if (!other) throw new Error('no space');
    const otherCtx = await contextOf(other.id);
    const otherPlan = await getPlan(db, otherCtx, NOW);
    expect(otherPlan.days.flatMap((d) => d.items)).toEqual([]);
    expect(await codeOf(() => updatePlan(db, otherCtx, { remove: [itemId] }, NOW))).toBe(
      'not-found',
    );
    expect(
      await codeOf(() => updatePlan(db, otherCtx, { update: [{ itemId, title: 'Theirs' }] }, NOW)),
    ).toBe('not-found');
    expect(await codeOf(() => updatePlan(db, otherCtx, { remove: ['not-a-uuid'] }, NOW))).toBe(
      'not-found',
    );
    expect(await storedCount(ctx.spaceId)).toBe(1);
  });

  it('refuses to change or remove a booked item', async () => {
    const { seed, ctx } = await newSpace();
    const { order } = await placeOrder(ctx, plusDays(seed.stay.checkIn, 1));
    const db = testDb.db;
    expect(await codeOf(() => updatePlan(db, ctx, { remove: [order.id] }, NOW))).toBe(
      'booked-item',
    );
    expect(
      await codeOf(() => updatePlan(db, ctx, { update: [{ itemId: order.id, title: 'X' }] }, NOW)),
    ).toBe('booked-item');
  });

  it('refuses a place or Offer the guest could not see', async () => {
    const { seed, ctx } = await newSpace();
    const db = testDb.db;
    const date = seed.stay.checkIn;
    for (const id of [unpublishedPlaceId, randomUUID(), 'nope']) {
      expect(
        await codeOf(() => updatePlan(db, ctx, { add: [{ date, title: 'A', placeId: id }] }, NOW)),
      ).toBe('place-not-visible');
    }
    const provider = await seedProvider(db);
    const hidden = await seedOrderableOffer(db, {
      providerId: provider.id,
      destinationId,
      availabilityMode: 'on_request',
    });
    for (const id of [hidden.offerId, 'nope']) {
      expect(
        await codeOf(() => updatePlan(db, ctx, { add: [{ date, title: 'A', offerId: id }] }, NOW)),
      ).toBe('offer-not-visible');
    }
    await publishOffer(db, hidden.offerId);
    await updatePlan(db, ctx, { add: [{ date, title: 'A', offerId: hidden.offerId }] }, NOW);
    expect(await storedCount(ctx.spaceId)).toBe(1);
  });

  it('allows at most 12 suggestions on one day', async () => {
    const { seed, ctx } = await newSpace();
    const db = testDb.db;
    const date = seed.stay.checkIn;
    const twelve = Array.from({ length: 12 }, (_, i) => ({ date, title: `Item ${i + 1}` }));
    await updatePlan(db, ctx, { add: twelve }, NOW);
    expect(
      await codeOf(() => updatePlan(db, ctx, { add: [{ date, title: 'Thirteenth' }] }, NOW)),
    ).toBe('day-full');
    expect(await storedCount(ctx.spaceId)).toBe(12);
  });
});
