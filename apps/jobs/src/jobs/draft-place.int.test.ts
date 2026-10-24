import {
  accounts,
  COMMONS_HOST,
  type CurationPayload,
  curationItemActions,
  draftCandidates,
  groupUnassigned,
  isDrafted,
  QUEUES,
  upsertSourceRows,
} from '@fetivi/domain';
import {
  createTestDatabase,
  EMPTY_EXTRACTION,
  recordedPagesFetch,
  recordingQueue,
  scriptedDraftingModel,
  seedDestination,
  type TestDatabase,
} from '@fetivi/domain/testing';
import { createEgress } from '@fetivi/egress';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { EGRESS_ALLOWLIST } from '../egress';
import { draftPlaceJob } from './draft-place';
import { createJobs } from './index';

const NOW = new Date('2027-04-01T09:00:00Z');
const VENUE = 'https://www.svdominik.com/';
const CONTACT = `${VENUE}contact/`;

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb?.drop();
});

afterEach(() => vi.unstubAllGlobals());

describe('draft-place job', () => {
  it('is registered and never retried, and only Commons joins the static allowlist', () => {
    const jobs = createJobs({} as Parameters<typeof createJobs>[0]);
    const job = jobs.find((j) => j.name === QUEUES.draftPlace);
    expect(job?.queue).toMatchObject({ retryLimit: 0 });
    expect(job?.cron).toBeUndefined();
    expect(EGRESS_ALLOWLIST).toContain(COMMONS_HOST);
    expect(EGRESS_ALLOWLIST).not.toContain('www.svdominik.com');
  });

  it('drafts a ticked candidate into an approvable item and logs ids and counts only', async () => {
    const [admin] = await testDb.db
      .insert(accounts)
      .values({ email: 'job-drafter@example.test', passwordHash: 'x', role: 'admin' })
      .returning();
    if (!admin) throw new Error('no admin');
    const destinationId = await seedDestination(testDb.db);
    await upsertSourceRows(
      testDb.db,
      destinationId,
      [
        {
          source: 'osm',
          externalId: 'node/7',
          name: 'Sv. Dominik',
          location: { lat: 43.5168, lng: 16.2512 },
          placeCategory: 'restaurant',
          licence: 'ODbL-1.0',
          sourceUrl: 'https://www.openstreetmap.org/node/7',
          data: { tags: { website: VENUE } },
        },
      ],
      NOW,
    );
    await groupUnassigned(testDb.db, destinationId, NOW);
    const [row] = await testDb.db.query.placeOpenDataSources.findMany({
      where: (t, { eq }) => eq(t.destinationId, destinationId),
    });
    if (!row?.candidateId) throw new Error('no candidate');
    const queue = recordingQueue();
    const ticked = await draftCandidates(
      testDb.db,
      queue,
      destinationId,
      [row.candidateId],
      admin.id,
      NOW,
    );
    expect(ticked).toEqual({ drafted: 1, run: { queued: 1, waiting: 0 } });
    const [sent] = queue.jobs;
    if (!sent) throw new Error('no job sent');
    expect(sent.name).toBe(QUEUES.draftPlace);
    const { taskId } = sent.data as { taskId: string };

    vi.stubGlobal(
      'fetch',
      recordedPagesFetch({
        [VENUE]: { file: 'konoba-venue.html' },
        [CONTACT]: { file: 'konoba-contact.html' },
      }),
    );
    const model = scriptedDraftingModel(() => ({
      ...EMPTY_EXTRACTION,
      title: { value: 'Restoran Sv. Dominik', sourceUrl: VENUE },
      phone: { value: '+385 21 000 000', sourceUrl: CONTACT },
    }));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await draftPlaceJob({
        db: testDb.db,
        draftingModel: model,
        fetchFor: (allowlist) => createEgress({ allowlist }).fetch,
        fetch: async () => {
          throw new Error('no Commons request expected');
        },
        userAgent: 'Fetivi test',
        now: () => NOW,
      }).handler({ taskId });
      expect(log).toHaveBeenCalledTimes(1);
      const line = String(log.mock.calls[0]?.[0]);
      expect(JSON.parse(line)).toEqual({
        job: QUEUES.draftPlace,
        taskId,
        status: 'drafted',
        pages: 2,
        fields: 2,
      });
      expect(line).not.toContain('svdominik');
    } finally {
      log.mockRestore();
    }

    const item = await testDb.db.query.curationItems.findFirst({
      where: (t, { eq }) => eq(t.dedupeKey, `seeding-candidate:${row.candidateId}`),
    });
    const payload = item?.payload as CurationPayload;
    expect(isDrafted(payload)).toBe(true);
    expect(curationItemActions('draft', false, isDrafted(payload))).toContain('approve');
  });
});
