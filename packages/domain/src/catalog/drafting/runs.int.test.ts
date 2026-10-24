import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enqueueCurationItem } from '../../curation/store';
import { accounts } from '../../db/schema/accounts';
import { draftingTasks } from '../../db/schema/drafting';
import { QUEUES } from '../../jobs/queue';
import {
  createTestDatabase,
  noopQueue,
  recordingQueue,
  seedDestination,
  type TestDatabase,
} from '../../testing';
import { createCatalogRecord, markVerified } from '../store';
import { DraftingRuleError } from './errors';
import { draftingStatus, finishTask, startDraftingRun, startRefreshRun } from './runs';

const NOW = new Date('2027-04-01T09:00:00Z');
const LATER = new Date('2027-04-01T09:05:00Z');
const DAY = 86_400_000;

let testDb: TestDatabase;
let adminId: string;

beforeAll(async () => {
  testDb = await createTestDatabase();
  const [admin] = await testDb.db
    .insert(accounts)
    .values({ email: 'drafter@example.test', passwordHash: 'x', role: 'admin' })
    .returning();
  if (!admin) throw new Error('no admin');
  adminId = admin.id;
});

afterAll(async () => {
  await testDb?.drop();
});

/** `n` open candidate drafts, one millisecond apart so their order is fixed. */
async function candidateDrafts(destinationId: string, n: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const candidateId = randomUUID();
    const { id } = await enqueueCurationItem(
      testDb.db,
      {
        destinationId,
        dedupeKey: `seeding-candidate:${candidateId}`,
        payload: { kind: 'draft', changes: {}, candidateId },
      },
      new Date(NOW.getTime() - DAY + i),
    );
    ids.push(id);
  }
  return ids;
}

async function verifiedPlace(destinationId: string, verifiedAt: Date | null, title = 'Konoba') {
  const record = await createCatalogRecord(
    testDb.db,
    noopQueue,
    {
      destinationId,
      kind: 'place',
      title,
      description: 'Text.',
      placeCategory: 'restaurant',
      location: { x: 16.25, y: 43.51 },
    },
    NOW,
  );
  if (verifiedAt) await markVerified(testDb.db, record.id, adminId, verifiedAt);
  return record.id;
}

const tasksOf = (runId: string) =>
  testDb.db.select().from(draftingTasks).where(eq(draftingTasks.runId, runId));

describe('startDraftingRun', () => {
  it('caps a run at 25 and leaves the rest for the next run', async () => {
    const destinationId = await seedDestination(testDb.db);
    const items = await candidateDrafts(destinationId, 30);
    const queue = recordingQueue();
    const first = await testDb.db.transaction((tx) =>
      startDraftingRun(tx, queue, destinationId, adminId, NOW),
    );
    expect(first).toMatchObject({ queued: 25, waiting: 5 });
    expect(queue.jobs).toHaveLength(25);
    expect(queue.jobs.every((j) => j.name === QUEUES.draftPlace)).toBe(true);
    const tasks = await tasksOf(first.runId ?? '');
    expect(new Set(tasks.map((t) => t.curationItemId))).toEqual(new Set(items.slice(0, 25)));

    const second = await testDb.db.transaction((tx) =>
      startDraftingRun(tx, queue, destinationId, adminId, LATER),
    );
    expect(second).toMatchObject({ queued: 5, waiting: 0 });
    const secondTasks = await tasksOf(second.runId ?? '');
    expect(new Set(secondTasks.map((t) => t.curationItemId))).toEqual(new Set(items.slice(25)));

    const third = await testDb.db.transaction((tx) =>
      startDraftingRun(tx, queue, destinationId, adminId, LATER),
    );
    expect(third).toEqual({ runId: null, queued: 0, waiting: 0 });
    expect(queue.jobs).toHaveLength(30);
  });

  it('retries failed drafts but not drafted or sourceless ones', async () => {
    const destinationId = await seedDestination(testDb.db);
    const at = NOW.toISOString();
    const make = (status: 'drafted' | 'no_sources' | 'failed') =>
      enqueueCurationItem(
        testDb.db,
        {
          destinationId,
          payload: {
            kind: 'draft',
            changes: {},
            candidateId: randomUUID(),
            drafting: { status, at, pages: [] },
          },
        },
        NOW,
      );
    await make('drafted');
    await make('no_sources');
    const failed = await make('failed');
    const queue = recordingQueue();
    const run = await testDb.db.transaction((tx) =>
      startDraftingRun(tx, queue, destinationId, adminId, NOW),
    );
    expect(run.queued).toBe(1);
    const [task] = await tasksOf(run.runId ?? '');
    expect(task?.curationItemId).toBe(failed.id);
  });

  it('frees a task whose job was lost', async () => {
    const destinationId = await seedDestination(testDb.db);
    await candidateDrafts(destinationId, 1);
    const first = await testDb.db.transaction((tx) =>
      startDraftingRun(tx, noopQueue, destinationId, adminId, NOW),
    );
    expect(first.queued).toBe(1);
    const soon = await testDb.db.transaction((tx) =>
      startDraftingRun(tx, noopQueue, destinationId, adminId, LATER),
    );
    expect(soon.queued).toBe(0);
    const hourLater = new Date(NOW.getTime() + 60 * 60_000);
    const status = await draftingStatus(testDb.db, destinationId, hourLater);
    expect(status.draft?.counts.failed).toBe(1);
    const retry = await testDb.db.transaction((tx) =>
      startDraftingRun(tx, noopQueue, destinationId, adminId, hourLater),
    );
    expect(retry.queued).toBe(1);
  });

  it('throws not-found for an unknown destination', async () => {
    await expect(
      testDb.db.transaction((tx) => startDraftingRun(tx, noopQueue, randomUUID(), adminId, NOW)),
    ).rejects.toEqual(new DraftingRuleError('not-found'));
  });
});

describe('startRefreshRun', () => {
  it('skips unverified, diffed and recently refreshed records, and refuses a second run', async () => {
    const destinationId = await seedDestination(testDb.db);
    const old = await verifiedPlace(destinationId, new Date(NOW.getTime() - 300 * DAY), 'Old');
    const recent = await verifiedPlace(destinationId, new Date(NOW.getTime() - 100 * DAY), 'New');
    await verifiedPlace(destinationId, null, 'Unverified');
    const diffed = await verifiedPlace(destinationId, new Date(NOW.getTime() - 200 * DAY));
    await enqueueCurationItem(
      testDb.db,
      {
        destinationId,
        recordId: diffed,
        payload: { kind: 'refresh_diff', changes: { phone: '1' }, previous: {} },
      },
      NOW,
    );
    const refreshed = await verifiedPlace(destinationId, new Date(NOW.getTime() - 250 * DAY));
    const earlier = new Date(NOW.getTime() - 10 * DAY);
    const earlierRun = await startRefreshRun(testDb.db, noopQueue, destinationId, adminId, earlier);
    const earlierTasks = await tasksOf(earlierRun.runId ?? '');
    for (const t of earlierTasks) {
      await finishTask(
        testDb.db,
        t.id,
        t.recordId === refreshed ? 'unchanged' : 'failed',
        t.recordId === refreshed ? null : 'model-error',
        earlier,
      );
    }

    const queue = recordingQueue();
    const run = await startRefreshRun(testDb.db, queue, destinationId, adminId, NOW);
    const tasks = await tasksOf(run.runId ?? '');
    // Oldest verified first; the failed earlier refreshes are retried.
    expect(run).toMatchObject({ queued: 2, waiting: 0 });
    expect(new Set(tasks.map((t) => t.recordId))).toEqual(new Set([old, recent]));
    expect(queue.jobs.every((j) => j.name === QUEUES.refreshCatalog)).toBe(true);

    await expect(startRefreshRun(testDb.db, queue, destinationId, adminId, LATER)).rejects.toEqual(
      new DraftingRuleError('run-running'),
    );
  });
});

describe('draftingStatus', () => {
  it('counts waiting drafts, the last run per kind and the places due', async () => {
    const destinationId = await seedDestination(testDb.db);
    await candidateDrafts(destinationId, 3);
    await verifiedPlace(destinationId, new Date(NOW.getTime() - 100 * DAY));
    const empty = await draftingStatus(testDb.db, destinationId, NOW);
    expect(empty).toEqual({ waiting: 3, draft: null, refresh: null, refreshDue: 1 });

    const run = await testDb.db.transaction((tx) =>
      startDraftingRun(tx, noopQueue, destinationId, adminId, NOW),
    );
    // Queued tasks are not waiting.
    expect((await draftingStatus(testDb.db, destinationId, NOW)).waiting).toBe(0);
    const [a, b] = await tasksOf(run.runId ?? '');
    if (!a || !b) throw new Error('no tasks');
    expect(await finishTask(testDb.db, a.id, 'drafted', null, LATER)).toBe(true);
    expect(await finishTask(testDb.db, a.id, 'failed', 'model-error', LATER)).toBe(false);
    await finishTask(testDb.db, b.id, 'no_sources', null, LATER);

    const status = await draftingStatus(testDb.db, destinationId, LATER);
    expect(status.refresh).toBeNull();
    expect(status.draft).toMatchObject({ id: run.runId, cap: 25, waiting: 0 });
    expect(status.draft?.counts).toEqual({
      queued: 1,
      drafted: 1,
      diffed: 0,
      unchanged: 0,
      no_sources: 1,
      failed: 0,
    });
  });

  it('throws not-found for an unknown destination', async () => {
    await expect(draftingStatus(testDb.db, randomUUID(), NOW)).rejects.toEqual(
      new DraftingRuleError('not-found'),
    );
  });
});
