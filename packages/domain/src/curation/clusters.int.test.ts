import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { curationItems } from '../db/schema/curation';
import { fallbackLog } from '../db/schema/fallback';
import type { FallbackOutcome } from '../fallback/vocabulary';
import { createTestDatabase, seedDestination, type TestDatabase } from '../testing';
import { clusterFallbackTopics } from './clusters';

// Runs Monday 2027-07-12 03:00Z; the week is 2027-07-05T00:00Z (inclusive) to 2027-07-12 (exclusive).
const RUN = new Date('2027-07-12T03:00:00Z');
const IN_WEEK = new Date('2027-07-07T10:00:00Z');

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb?.drop();
});

function log(
  destinationId: string | null,
  topic: string | null,
  outcome: FallbackOutcome,
  place: string | null = null,
  createdAt = IN_WEEK,
) {
  return { destinationId, topic, place, outcome, createdAt };
}

describe('clusterFallbackTopics', () => {
  it('groups last week by destination and word set, once', async () => {
    const a = await seedDestination(testDb.db);
    const b = await seedDestination(testDb.db);
    await testDb.db
      .insert(fallbackLog)
      .values([
        log(a, 'kayak rental', 'results', 'okrug', new Date('2027-07-05T00:00:00Z')),
        log(a, 'rental kayak', 'no_results', 'okrug'),
        log(a, 'kayak rental', 'unavailable', 'seget'),
        log(a, 'boat tour', 'results'),
        log(b, 'kayak rental', 'results'),
        log(null, 'kayak rental', 'no_results'),
        log(a, null, 'rejected'),
        log(a, 'kayak rental', 'results', null, new Date('2027-07-12T00:00:00Z')),
        log(a, 'kayak rental', 'results', null, new Date('2027-07-04T23:59:59Z')),
      ]);

    expect(await clusterFallbackTopics(testDb.db, RUN)).toEqual({
      rows: 6,
      clusters: 4,
      created: 4,
    });
    const items = await testDb.db
      .select()
      .from(curationItems)
      .where(eq(curationItems.kind, 'fallback_topic_cluster'));
    expect(items).toHaveLength(4);
    const kayakA = items.find(
      (i) => i.destinationId === a && (i.payload as { topic: string }).topic === 'kayak rental',
    );
    expect(kayakA).toMatchObject({
      status: 'open',
      dedupeKey: `fallback:${a}:kayak rental:2027-07-05`,
      payload: {
        kind: 'fallback_topic_cluster',
        topic: 'kayak rental',
        topics: ['kayak rental', 'rental kayak'],
        places: ['okrug', 'seget'],
        count: 3,
        noResults: 2,
        weekStart: '2027-07-05',
      },
    });
    const none = items.find((i) => i.destinationId === null);
    expect(none?.dedupeKey).toBe('fallback:none:kayak rental:2027-07-05');

    expect(await clusterFallbackTopics(testDb.db, RUN)).toEqual({
      rows: 6,
      clusters: 4,
      created: 0,
    });
    const again = await testDb.db
      .select()
      .from(curationItems)
      .where(eq(curationItems.kind, 'fallback_topic_cluster'));
    expect(again).toHaveLength(4);
  });
});
