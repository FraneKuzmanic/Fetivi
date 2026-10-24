import { QUEUES, RETENTION_CRON, readOnlyEndsAt } from '@fetivi/domain';
import { createTestDatabase, seedGuestUnit, type TestDatabase } from '@fetivi/domain/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createJobs } from './index';
import { retentionJob } from './retention';

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb?.drop();
});

describe('retention job', () => {
  it('is scheduled daily', () => {
    const jobs = createJobs({} as Parameters<typeof createJobs>[0]);
    expect(jobs.find((j) => j.name === QUEUES.retention)?.cron).toBe(RETENTION_CRON);
  });

  it('deletes a due Space and logs counts only', async () => {
    const unit = await seedGuestUnit(testDb.db, { now: new Date('2027-07-01T10:00:00Z') });
    const now = readOnlyEndsAt(unit.stay.activeUntil);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await retentionJob({ db: testDb.db, now: () => now }).handler({});
      expect(log).toHaveBeenCalledWith(
        JSON.stringify({
          job: QUEUES.retention,
          deleted: 1,
          kept: 0,
          held: 0,
          ledger: 0,
          purged: 0,
        }),
      );
    } finally {
      log.mockRestore();
    }
    const space = await testDb.db.query.spaces.findFirst({
      where: (t, { eq }) => eq(t.id, unit.spaceId),
    });
    expect(space).toBeUndefined();
  });
});
