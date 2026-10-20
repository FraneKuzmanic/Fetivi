import { eq, sql } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedTrogir } from '../../catalog/seed/trogir';
import { allotmentSlots, offers, providers } from '../../db/schema/offers';
import { createJobQueue, ensureQueues, type JobQueue, QUEUES } from '../../jobs/queue';
import { createTestDatabase, type TestDatabase } from '../../testing';
import { seedTrogirServices } from './trogir';

let testDb: TestDatabase;
let boss: PgBoss;
let queue: JobQueue;
const NOW = new Date('2027-05-01T10:00:00Z');

beforeAll(async () => {
  testDb = await createTestDatabase();
  boss = new PgBoss({ connectionString: testDb.url, supervise: false, schedule: false });
  boss.on('error', console.error);
  await boss.start();
  await ensureQueues(boss);
  queue = createJobQueue(boss);
});

afterAll(async () => {
  await boss?.stop({ graceful: false, timeout: 1000 });
  await testDb?.drop();
});

const jobCount = async () => {
  const { rows } = await testDb.db.execute<{ n: number }>(
    sql`select count(*)::int as n from pgboss.job where name = ${QUEUES.translateOffer}`,
  );
  return rows[0]?.n ?? 0;
};

describe('seedTrogirServices', () => {
  it('creates a Provider with an allotment boat trip and an on-request Offer, once', async () => {
    const { destinationId } = await seedTrogir(testDb.db, queue, NOW);
    const result = await seedTrogirServices(testDb.db, queue, NOW, destinationId);
    expect(result.created).toBe(true);

    expect(await testDb.db.select().from(providers)).toHaveLength(1);
    const rows = await testDb.db
      .select()
      .from(offers)
      .where(eq(offers.providerId, result.providerId));
    expect(rows.map((o) => o.availabilityMode).sort()).toEqual(['allotment', 'on_request']);
    expect(rows.every((o) => o.destinationId === destinationId)).toBe(true);

    const boatTrip = rows.find((o) => o.availabilityMode === 'allotment');
    if (!boatTrip) throw new Error('no boat trip');
    const slots = await testDb.db
      .select()
      .from(allotmentSlots)
      .where(eq(allotmentSlots.offerId, boatTrip.id));
    expect(slots).toHaveLength(60);
    expect(slots.every((s) => s.startsAt > NOW && s.capacity === 12 && s.remaining === 12)).toBe(
      true,
    );
    expect(await jobCount()).toBe(2);

    const again = await seedTrogirServices(testDb.db, queue, NOW, destinationId);
    expect(again).toEqual({ providerId: result.providerId, created: false });
    expect(await testDb.db.select().from(offers)).toHaveLength(2);
    expect(await jobCount()).toBe(2);
  });
});
