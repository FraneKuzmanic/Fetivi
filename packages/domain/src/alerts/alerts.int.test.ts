import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCatalogRecord } from '../catalog/store';
import { planItems } from '../db/schema/plan';
import { spaces } from '../db/schema/spaces';
import { stays } from '../db/schema/stays';
import { completeOrder, prepareOrder } from '../services/pending/create-order';
import { loadSituation } from '../situation/load';
import {
  createTestDatabase,
  noopQueue,
  publishOffer,
  seedDestination,
  seedGuestUnit,
  seedOrderableOffer,
  seedProvider,
  type TestDatabase,
} from '../testing';
import { fromLocalDateTime } from '../time';
import { listAlertSpaces } from './spaces';

const NOW = new Date('2027-07-10T08:00:00Z');
const ZONE = 'Europe/Zagreb';

let testDb: TestDatabase;
let destinationId: string;

const plusDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  testDb = await createTestDatabase();
  destinationId = await seedDestination(testDb.db);
});

afterAll(async () => {
  await testDb?.drop();
});

async function dayTrip(title: string, ferryLines: string[]) {
  const record = await createCatalogRecord(
    testDb.db,
    noopQueue,
    {
      destinationId,
      kind: 'day_trip',
      title,
      description: 'By sea.',
      travelMinutes: 90,
      ferryLines,
    },
    NOW,
  );
  return record.id;
}

async function suggest(
  spaceId: string,
  date: string,
  over: Partial<typeof planItems.$inferInsert>,
) {
  await testDb.db
    .insert(planItems)
    .values({ spaceId, date, title: 'Item', createdAt: NOW, updatedAt: NOW, ...over });
}

/** A confirmed Order at 09:00 on `day` for an Offer at `placeId`. */
async function book(spaceId: string, day: string, placeId: string) {
  const db = testDb.db;
  const situation = await loadSituation(db, spaceId, NOW);
  if (!situation) throw new Error('no space');
  const offerScope = {
    destinationId,
    propertyId: situation.propertyId,
    language: situation.language,
  };
  const provider = await seedProvider(db);
  const boat = await seedOrderableOffer(db, {
    providerId: provider.id,
    destinationId,
    availabilityMode: 'allotment',
    startsAt: fromLocalDateTime(`${day}T09:00`, ZONE),
    capacity: 10,
    title: 'Hvar boat trip',
    placeId,
  });
  await publishOffer(db, boat.offerId);
  const deps = { db, queue: noopQueue, now: () => NOW };
  const { pendingId } = await prepareOrder(
    deps,
    { spaceId, offerScope },
    { offerId: boat.offerId, date: day, quantity: 2 },
  );
  const { order } = await completeOrder(deps, {
    pendingId,
    spaceId,
    offerScope,
    contact: { email: 'guest@example.test', name: 'Ana' },
  });
  return { orderId: order.id, offerId: boat.offerId };
}

describe('listAlertSpaces', () => {
  it('lists open spaces with their line-dependent items, possibly cancelled Stays included', async () => {
    const db = testDb.db;
    const bol = await dayTrip('Bol', ['9603']);
    const hvar = await dayTrip('Hvar', ['635']);
    const krka = await dayTrip('Krka', []);

    const open = await seedGuestUnit(db, { now: NOW, nights: 3 });
    const day1 = open.stay.checkIn;
    const day2 = plusDays(day1, 1);
    await suggest(open.spaceId, day1, { title: 'Bol day', startTime: '08:00', placeId: bol });
    await suggest(open.spaceId, day1, { title: 'Krka day', placeId: krka });
    const { orderId, offerId } = await book(open.spaceId, day2, hvar);
    // A suggestion that points at the same Offer reaches the line through the Offer's place.
    await suggest(open.spaceId, day2, { title: 'Boat again', startTime: '15:00', offerId });

    const cancelled = await seedGuestUnit(db, { now: NOW, nights: 2 });
    await db.update(stays).set({ possiblyCancelled: true }).where(eq(stays.id, cancelled.stayId));
    const closed = await seedGuestUnit(db, { now: NOW, nights: 2 });
    await db
      .update(spaces)
      .set({ closedAt: new Date(NOW.getTime() - 1000) })
      .where(eq(spaces.id, closed.spaceId));

    const listed = await listAlertSpaces(db, NOW);
    const ids = listed.map((s) => s.spaceId);
    expect(ids).toContain(open.spaceId);
    expect(ids).toContain(cancelled.spaceId);
    expect(ids).not.toContain(closed.spaceId);

    const mine = listed.find((s) => s.spaceId === open.spaceId);
    expect(mine).toMatchObject({
      zone: ZONE,
      place: { lat: 43.5167, lng: 16.2516 },
      checkIn: day1,
    });
    expect(mine?.items).toEqual([
      { title: 'Bol day', date: day1, startTime: '08:00', orderId: null, lines: ['9603'] },
      {
        title: '[en] Hvar boat trip',
        date: day2,
        startTime: '09:00',
        orderId,
        lines: ['635'],
      },
      { title: 'Boat again', date: day2, startTime: '15:00', orderId: null, lines: ['635'] },
    ]);
    expect(listed.find((s) => s.spaceId === cancelled.spaceId)?.items).toEqual([]);
  });
});
