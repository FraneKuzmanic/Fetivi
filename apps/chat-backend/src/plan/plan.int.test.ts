import {
  completeOrder,
  fromLocalDateTime,
  loadSituation,
  prepareOrder,
  updatePlan,
} from '@fetivi/domain';
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

async function scopeOf(spaceId: string) {
  const ctx = await loadSituation(t.db, spaceId, t.clock.now());
  if (!ctx) throw new Error('no space');
  return {
    language: ctx.language,
    offerScope: {
      destinationId: ctx.destinationId,
      propertyId: ctx.propertyId,
      language: ctx.language,
    },
  };
}

/** One Order made through the domain halves, as create_order makes it. */
async function placeOrder(spaceId: string, offerId: string, date: string) {
  const { offerScope } = await scopeOf(spaceId);
  const deps = { db: t.db, queue: noopQueue, now: t.clock.now };
  const { pendingId } = await prepareOrder(
    deps,
    { spaceId, offerScope },
    { offerId, date, quantity: 1 },
  );
  return completeOrder(deps, {
    pendingId,
    spaceId,
    offerScope,
    contact: { email: 'guest@example.test', name: 'Ana' },
    details: { note: null, time: null },
  });
}

interface PlanBody {
  plan: {
    checkIn: string;
    checkout: string;
    days: { date: string; items: { kind: string; title: string; time: string | null }[] }[];
  };
}

describe('GET /api/plan', () => {
  it('needs a space', async () => {
    const response = await get(t.app, '/api/plan');
    expect([response.statusCode, response.json()]).toEqual([401, { error: 'no-space' }]);
  });

  it('shows every Stay day, booked Orders and the space own suggestions, also after checkout', async () => {
    const seed = await seedGuestUnit(t.db, { now: t.clock.now(), checkInInDays: 2, nights: 2 });
    const { cookie, space } = await enterSpace(t, seed);

    const empty = (await get(t.app, '/api/plan', cookie)).json() as PlanBody;
    expect(empty.plan.days.map((d) => d.date)).toEqual([
      seed.stay.checkIn,
      plusDays(seed.stay.checkIn, 1),
      seed.stay.checkout,
    ]);
    expect(empty.plan.days.every((d) => d.items.length === 0)).toBe(true);

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
    await placeOrder(space.space.id, boat.offerId, day);
    await updatePlan(
      t.db,
      { spaceId: space.space.id, ...(await scopeOf(space.space.id)) },
      { add: [{ date: day, title: 'Dinner in the old town' }] },
      t.clock.now(),
    );

    const filled = (await get(t.app, '/api/plan', cookie)).json() as PlanBody;
    expect(filled.plan.days.find((d) => d.date === day)?.items).toMatchObject([
      { kind: 'order', title: '[en] Blue Lagoon boat trip', time: '09:00' },
      { kind: 'suggestion', title: 'Dinner in the old town', time: null },
    ]);

    // Another space of the same Stay sees none of these.
    const other = await enterSpace(t, seed);
    const theirs = (await get(t.app, '/api/plan', other.cookie)).json() as PlanBody;
    expect(theirs.plan.days.every((d) => d.items.length === 0)).toBe(true);

    t.clock.advance(space.space.closedAt.getTime() - t.clock.now().getTime() + 60_000);
    const after = await get(t.app, '/api/plan', cookie);
    expect(after.statusCode).toBe(200);
    expect((after.json() as PlanBody).plan.days.find((d) => d.date === day)?.items).toHaveLength(2);
  });
});
