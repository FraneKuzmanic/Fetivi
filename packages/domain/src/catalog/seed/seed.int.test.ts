import { eq, sql } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { catalogRecords, destinations } from '../../db/schema/catalog';
import { createJobQueue, ensureQueues, type JobQueue, QUEUES } from '../../jobs/queue';
import { createTestDatabase, type TestDatabase } from '../../testing';
import { findDestinationAt } from '../destination';
import { seedTrogir } from './trogir';

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
    sql`select count(*)::int as n from pgboss.job where name = ${QUEUES.translateCatalogRecord}`,
  );
  return rows[0]?.n ?? 0;
};

describe('seedTrogir', () => {
  it('creates Trogir with seven verified records and queues their translations', async () => {
    const result = await seedTrogir(testDb.db, queue, NOW);
    expect(result.created).toBe(true);
    const records = await testDb.db
      .select()
      .from(catalogRecords)
      .where(eq(catalogRecords.destinationId, result.destinationId));
    const kinds = records.map((r) => r.kind).sort();
    expect(kinds).toEqual([
      'day_trip',
      'event',
      'place',
      'place',
      'place',
      'place',
      'transport_note',
    ]);
    expect(records.every((r) => r.verifiedAt?.getTime() === NOW.getTime())).toBe(true);
    expect(await jobCount()).toBe(7);

    for (const r of records.filter((r) => r.kind === 'place')) {
      if (!r.location) throw new Error('place without location');
      const at = await findDestinationAt(testDb.db, { lat: r.location.y, lng: r.location.x });
      expect(at?.name).toBe('Trogir');
    }
    const krka = records.find((r) => r.kind === 'day_trip');
    if (!krka?.location) throw new Error('no Krka location');
    expect(await findDestinationAt(testDb.db, { lat: krka.location.y, lng: krka.location.x })).toBe(
      null,
    );
  });

  it('adds nothing on a second run', async () => {
    const again = await seedTrogir(testDb.db, queue, NOW);
    expect(again.created).toBe(false);
    expect(await testDb.db.select().from(destinations)).toHaveLength(1);
    expect(await testDb.db.select().from(catalogRecords)).toHaveLength(7);
    expect(await jobCount()).toBe(7);
  });
});
