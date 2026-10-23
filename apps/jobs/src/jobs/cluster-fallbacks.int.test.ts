import { CLUSTER_FALLBACKS_CRON, fallbackLog, QUEUES } from '@fetivi/domain';
import { createTestDatabase, seedDestination, type TestDatabase } from '@fetivi/domain/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { clusterFallbacksJob } from './cluster-fallbacks';
import { createJobs } from './index';

// Monday 2027-07-12 03:00Z: the previous week starts 2027-07-05.
const RUN = new Date('2027-07-12T03:00:00Z');

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb?.drop();
});

describe('cluster-fallbacks job', () => {
  it('is scheduled weekly', () => {
    const jobs = createJobs({} as Parameters<typeof createJobs>[0]);
    expect(jobs.find((j) => j.name === QUEUES.clusterFallbacks)?.cron).toBe(CLUSTER_FALLBACKS_CRON);
  });

  it("turns last week's topics into items and logs counts only", async () => {
    const destinationId = await seedDestination(testDb.db);
    const createdAt = new Date('2027-07-08T12:00:00Z');
    await testDb.db.insert(fallbackLog).values([
      { destinationId, topic: 'kayak rental', place: null, outcome: 'no_results', createdAt },
      { destinationId, topic: 'rental kayak', place: null, outcome: 'results', createdAt },
    ]);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await clusterFallbacksJob({ db: testDb.db, now: () => RUN }).handler({});
      expect(log).toHaveBeenCalledWith(
        JSON.stringify({ job: QUEUES.clusterFallbacks, rows: 2, clusters: 1, created: 1 }),
      );
    } finally {
      log.mockRestore();
    }
    const items = await testDb.db.query.curationItems.findMany({
      where: (t, { eq }) => eq(t.destinationId, destinationId),
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.payload).toMatchObject({ kind: 'fallback_topic_cluster', count: 2 });
  });
});
