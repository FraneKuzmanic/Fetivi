import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCatalogRecord, markVerified } from '../catalog/store';
import { catalogRecommendations } from '../db/schema/catalog';
import { createTestDatabase, noopQueue, seedDestination, type TestDatabase } from '../testing';
import { listStalenessQueue } from './staleness-queue';

const NOW = new Date('2027-07-10T09:00:00Z');
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);
const dayAgo = (n: number) => daysAgo(n).toISOString().slice(0, 10);

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb?.drop();
});

/** A restaurant (90-day budget) created a year ago, verified `verifiedDaysAgo` days ago. */
async function restaurant(destinationId: string, title: string, verifiedDaysAgo: number | null) {
  const record = await createCatalogRecord(
    testDb.db,
    noopQueue,
    {
      destinationId,
      kind: 'place',
      title,
      description: 'Food.',
      placeCategory: 'restaurant',
      location: { x: 16.25, y: 43.51 },
    },
    daysAgo(365),
  );
  if (verifiedDaysAgo !== null) {
    await markVerified(testDb.db, record.id, null, daysAgo(verifiedDaysAgo));
  }
  return record.id;
}

async function recommend(recordId: string, day: string, count: number) {
  await testDb.db.insert(catalogRecommendations).values({ recordId, day, count });
}

describe('listStalenessQueue', () => {
  it('keeps records past, near or never verified, and leaves out fresh ones and events', async () => {
    const destinationId = await seedDestination(testDb.db);
    await restaurant(destinationId, 'Fresh', 10);
    const near = await restaurant(destinationId, 'Near', 80);
    const past = await restaurant(destinationId, 'Past', 100);
    const never = await restaurant(destinationId, 'Never', null);
    await createCatalogRecord(
      testDb.db,
      noopQueue,
      {
        destinationId,
        kind: 'event',
        title: 'Festival',
        description: 'Music.',
        startsAt: daysAgo(400),
        endsAt: daysAgo(399),
      },
      daysAgo(400),
    );
    const queue = await listStalenessQueue(testDb.db, { now: NOW, destinationId });
    const byId = new Map(queue.map((r) => [r.id, r]));
    expect(new Set(byId.keys())).toEqual(new Set([near, past, never]));
    expect(byId.get(near)?.staleness).toEqual({
      status: 'fresh',
      staleAt: new Date(daysAgo(80).getTime() + 90 * DAY),
    });
    expect(byId.get(past)?.staleness.status).toBe('stale');
    expect(byId.get(never)?.staleness).toEqual({ status: 'never_verified', staleAt: null });
    expect(byId.get(past)).toMatchObject({ destinationId, title: 'Past', recommendations: 0 });
  });

  it('ranks the more recommended of two equally stale records first', async () => {
    const destinationId = await seedDestination(testDb.db);
    const quiet = await restaurant(destinationId, 'A quiet', 100);
    const popular = await restaurant(destinationId, 'B popular', 100);
    const veryStale = await restaurant(destinationId, 'C very stale', 300);
    await recommend(popular, dayAgo(5), 2);
    await recommend(popular, dayAgo(30), 1);
    // Outside the 90-day window: does not count.
    await recommend(quiet, dayAgo(120), 50);
    const queue = await listStalenessQueue(testDb.db, { now: NOW, destinationId });
    expect(queue.map((r) => r.id)).toEqual([popular, veryStale, quiet]);
    expect(queue[0]?.recommendations).toBe(3);
    expect(queue[2]?.recommendations).toBe(0);
    expect(queue[0]?.score).toBeCloseTo((100 / 90) * 4);
  });

  it('filters by destination', async () => {
    const a = await seedDestination(testDb.db);
    const b = await seedDestination(testDb.db);
    const inA = await restaurant(a, 'In A', null);
    await restaurant(b, 'In B', null);
    expect(
      (await listStalenessQueue(testDb.db, { now: NOW, destinationId: a })).map((r) => r.id),
    ).toEqual([inA]);
    const all = await listStalenessQueue(testDb.db, { now: NOW });
    expect(all.some((r) => r.destinationId === b)).toBe(true);
  });
});
