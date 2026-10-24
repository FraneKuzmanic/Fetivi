import { randomBytes } from 'node:crypto';
import {
  accounts,
  BATHING_WATER_ENDPOINT,
  destinations,
  OVERPASS_ENDPOINT,
  OVERTURE_STAC_ROOT,
  QUEUES,
  SEEDING_HOSTS,
  startImport,
} from '@fetivi/domain';
import {
  createTestDatabase,
  readRecorded,
  recordingQueue,
  type TestDatabase,
  TROGIR,
} from '@fetivi/domain/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EGRESS_ALLOWLIST } from '../egress';
import { importOpenDataJob } from './import-open-data';
import { createJobs } from './index';

const NOW = new Date('2027-05-01T10:00:00Z');

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb?.drop();
});

/** Serves the recorded Overpass and bathing-water responses; Overture's STAC root is down. */
function recordedFetch() {
  const calls: { url: string; method: string; userAgent: string | null }[] = [];
  const fetch = async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';
    calls.push({ url, method, userAgent: new Headers(init.headers).get('user-agent') });
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    if (url === OVERPASS_ENDPOINT && method === 'POST') return json(readRecorded('osm'));
    if (url.startsWith(`${BATHING_WATER_ENDPOINT}?`)) return json(readRecorded('bathing_water'));
    if (url === OVERTURE_STAC_ROOT) return new Response('unavailable', { status: 503 });
    throw new Error(`unexpected request ${method} ${url}`);
  };
  return { fetch, calls };
}

describe('import-open-data job', () => {
  it('is registered and never retried', () => {
    const jobs = createJobs({} as Parameters<typeof createJobs>[0]);
    const job = jobs.find((j) => j.name === QUEUES.importOpenData);
    expect(job?.queue).toMatchObject({ retryLimit: 0 });
    expect(job?.cron).toBeUndefined();
  });

  it('may reach every seeding source host', () => {
    for (const host of SEEDING_HOSTS) expect(EGRESS_ALLOWLIST).toContain(host);
  });

  it('imports the sources that answer and logs counts only', async () => {
    const [admin] = await testDb.db
      .insert(accounts)
      .values({ email: 'job-seeder@example.test', passwordHash: 'x', role: 'admin' })
      .returning();
    const [destination] = await testDb.db
      .insert(destinations)
      .values({ name: `Trogir ${randomBytes(4).toString('hex')}`, centre: TROGIR, radiusM: 3000 })
      .returning();
    if (!admin || !destination) throw new Error('not seeded');
    const run = await startImport(testDb.db, recordingQueue(), destination.id, admin.id, NOW);
    const { fetch, calls } = recordedFetch();

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await importOpenDataJob({
        db: testDb.db,
        fetch,
        userAgent: 'Fetivi test',
        now: () => NOW,
      }).handler({ importId: run.id });
      expect(log).toHaveBeenCalledTimes(1);
      const line = JSON.parse(String(log.mock.calls[0]?.[0]));
      expect(line).toEqual({
        job: QUEUES.importOpenData,
        importId: run.id,
        osm: 'ok',
        bathing_water: 'ok',
        overture: 'failed',
        status: 'done',
        rows: 187 + 11,
        candidates: expect.any(Number),
      });
      expect(line.candidates).toBeGreaterThan(0);
    } finally {
      log.mockRestore();
    }

    expect(calls.find((c) => c.url === OVERPASS_ENDPOINT)?.userAgent).toBe('Fetivi test');
    const row = await testDb.db.query.seedingImports.findFirst({
      where: (t, { eq }) => eq(t.id, run.id),
    });
    expect(row).toMatchObject({
      status: 'done',
      finishedAt: NOW,
      sources: {
        osm: { outcome: 'ok', fetched: 242, kept: 187, skipped: 55 },
        bathing_water: { outcome: 'ok', fetched: 11, kept: 11, skipped: 0 },
        overture: { outcome: 'failed', failure: 'unavailable' },
      },
    });
  });

  it('does nothing for an import that is no longer running', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await importOpenDataJob({
        db: testDb.db,
        fetch: async () => {
          throw new Error('no request expected');
        },
        userAgent: 'Fetivi test',
        now: () => NOW,
      }).handler({ importId: '00000000-0000-4000-8000-000000000000' });
      expect(log).toHaveBeenCalledWith(
        JSON.stringify({
          job: QUEUES.importOpenData,
          importId: '00000000-0000-4000-8000-000000000000',
          skipped: true,
        }),
      );
    } finally {
      log.mockRestore();
    }
  });
});
