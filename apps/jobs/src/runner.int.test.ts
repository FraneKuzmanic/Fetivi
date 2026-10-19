import { createTestDatabase, type TestDatabase } from '@fetivi/domain/testing';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startJobRunner } from './runner';

let testDb: TestDatabase;
let boss: PgBoss;
let ran: Promise<void>;

beforeAll(async () => {
  testDb = await createTestDatabase();
  let markRan: () => void = () => {};
  ran = new Promise((resolve) => {
    markRan = resolve;
  });
  boss = await startJobRunner({
    connectionString: testDb.url,
    fast: true,
    jobs: [{ name: 'noop', cron: '* * * * * *', handler: async () => markRan() }],
  });
});

afterAll(async () => {
  await boss?.stop({ graceful: false, timeout: 1000 });
  await testDb?.drop();
});

describe('job runner', () => {
  it('registers the schedule', async () => {
    const schedules = await boss.getSchedules('noop');
    expect(schedules).toHaveLength(1);
  });

  it('runs a scheduled job', async () => {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('scheduled job did not run within 20 s')), 20_000);
    });
    try {
      await expect(Promise.race([ran, timeout])).resolves.toBeUndefined();
    } finally {
      clearTimeout(timer);
    }
  }, 25_000);
});
