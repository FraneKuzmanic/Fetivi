import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../testing';
import { createJobQueue, EVENTS, ensureQueues, type JobQueue, QUEUES, uuidFrom } from './queue';

let testDb: TestDatabase;
let boss: PgBoss;
let queue: JobQueue;

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

describe('uuidFrom', () => {
  it('is stable and UUID-shaped', () => {
    const id = uuidFrom('translate:a:1');
    expect(id).toBe(uuidFrom('translate:a:1'));
    expect(id).not.toBe(uuidFrom('translate:a:2'));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('job queue', () => {
  it('sends a job inside a committed transaction', async () => {
    const id = uuidFrom('committed');
    await testDb.db.transaction(async (tx) => {
      await queue.send(QUEUES.translateBlock, { n: 1 }, tx, { id });
    });
    const job = await boss.getJobById<{ n: number }>(QUEUES.translateBlock, id);
    expect(job?.data).toEqual({ n: 1 });
  });

  it('drops the job when the transaction rolls back', async () => {
    const id = uuidFrom('rolled-back');
    await expect(
      testDb.db.transaction(async (tx) => {
        await queue.send(QUEUES.translateBlock, { n: 2 }, tx, { id });
        throw new Error('roll back');
      }),
    ).rejects.toThrow('roll back');
    expect(await boss.getJobById(QUEUES.translateBlock, id)).toBeNull();
  });

  it('ignores a second send with the same id', async () => {
    const id = uuidFrom('twice');
    await queue.send(QUEUES.translateBlock, { n: 3 }, testDb.db, { id });
    await queue.send(QUEUES.translateBlock, { n: 4 }, testDb.db, { id });
    const job = await boss.getJobById<{ n: number }>(QUEUES.translateBlock, id);
    expect(job?.data).toEqual({ n: 3 });
  });

  it('publishes an event to subscribed queues', async () => {
    await boss.createQueue('test-sub');
    await boss.subscribe(EVENTS.unitProjectionInvalidated, 'test-sub');
    await testDb.db.transaction(async (tx) => {
      await queue.publish(EVENTS.unitProjectionInvalidated, { unitId: 'u1' }, tx);
    });
    const jobs = await boss.findJobs<{ unitId: string }>('test-sub');
    expect(jobs.map((j) => j.data)).toEqual([{ unitId: 'u1' }]);
  });
});
