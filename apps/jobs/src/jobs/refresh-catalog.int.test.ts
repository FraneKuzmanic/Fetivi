import {
  accounts,
  type CurationPayload,
  createCatalogRecord,
  markVerified,
  QUEUES,
  replaceOpeningHours,
  startRefreshRun,
} from '@fetivi/domain';
import {
  createTestDatabase,
  EMPTY_EXTRACTION,
  noopQueue,
  recordedPagesFetch,
  recordingQueue,
  scriptedDraftingModel,
  seedDestination,
  type TestDatabase,
} from '@fetivi/domain/testing';
import { createEgress } from '@fetivi/egress';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createJobs } from './index';
import { refreshCatalogJob } from './refresh-catalog';

const NOW = new Date('2027-04-01T09:00:00Z');
const VENUE = 'https://www.svdominik.com/';
const CONTACT = `${VENUE}contact/`;
const hours = (opens: string) =>
  [1, 2, 3].map((weekday) => ({ weekday, opens, closes: '23:00', validFrom: null, validTo: null }));

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb?.drop();
});

afterEach(() => vi.unstubAllGlobals());

describe('refresh-catalog job', () => {
  it('is registered and never retried', () => {
    const jobs = createJobs({} as Parameters<typeof createJobs>[0]);
    const job = jobs.find((j) => j.name === QUEUES.refreshCatalog);
    expect(job?.queue).toMatchObject({ retryLimit: 0 });
    expect(job?.cron).toBeUndefined();
  });

  it('queues one refresh diff when the hours changed', async () => {
    const [admin] = await testDb.db
      .insert(accounts)
      .values({ email: 'job-refresher@example.test', passwordHash: 'x', role: 'admin' })
      .returning();
    if (!admin) throw new Error('no admin');
    const destinationId = await seedDestination(testDb.db);
    const record = await createCatalogRecord(
      testDb.db,
      noopQueue,
      {
        destinationId,
        kind: 'place',
        title: 'Restoran Sv. Dominik',
        description: 'Text.',
        placeCategory: 'restaurant',
        location: { x: 16.2512, y: 43.5168 },
        websiteUrl: VENUE,
      },
      NOW,
    );
    await replaceOpeningHours(testDb.db, record.id, hours('12:00'), NOW);
    await markVerified(testDb.db, record.id, admin.id, new Date('2026-06-01T00:00:00Z'));
    const queue = recordingQueue();
    const run = await startRefreshRun(testDb.db, queue, destinationId, admin.id, NOW);
    expect(run).toMatchObject({ queued: 1, waiting: 0 });
    const [sent] = queue.jobs;
    if (!sent) throw new Error('no job sent');
    const { taskId } = sent.data as { taskId: string };

    vi.stubGlobal(
      'fetch',
      recordedPagesFetch({
        [VENUE]: { file: 'konoba-venue.html' },
        [CONTACT]: { file: 'konoba-contact.html' },
      }),
    );
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await refreshCatalogJob({
        db: testDb.db,
        draftingModel: scriptedDraftingModel(() => ({
          ...EMPTY_EXTRACTION,
          title: { value: 'Restoran Sv. Dominik', sourceUrl: VENUE },
          openingHours: { value: hours('15:00'), sourceUrl: CONTACT },
        })),
        fetchFor: (allowlist) => createEgress({ allowlist }).fetch,
        fetch: async () => {
          throw new Error('no Commons request expected');
        },
        userAgent: 'Fetivi test',
        now: () => NOW,
      }).handler({ taskId });
      expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual({
        job: QUEUES.refreshCatalog,
        taskId,
        status: 'diffed',
        pages: 2,
        fields: 1,
      });
    } finally {
      log.mockRestore();
    }

    const items = await testDb.db.query.curationItems.findMany({
      where: (t, { and, eq }) => and(eq(t.recordId, record.id), eq(t.kind, 'refresh_diff')),
    });
    expect(items).toHaveLength(1);
    const payload = items[0]?.payload as Extract<CurationPayload, { kind: 'refresh_diff' }>;
    expect(payload.changes.openingHours).toEqual(hours('15:00'));
    expect(payload.previous.openingHours).toEqual(hours('12:00'));
  });
});
