import { createMemoryMailer } from '@fetivi/domain';
import { createTestDatabase, seedGuestUnit, type TestDatabase } from '@fetivi/domain/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spaceEmailJob } from './space-email';

let testDb: TestDatabase;
const NOW = new Date('2027-05-01T10:00:00Z');

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb?.drop();
});

describe('space-email job', () => {
  it('a retried job sends with the same idempotency key, so the provider sends one email', async () => {
    const g = await seedGuestUnit(testDb.db, { now: NOW });
    await testDb.pool.query('update spaces set email = $1, email_opt_in_at = $2 where id = $3', [
      'guest@example.test',
      NOW,
      g.spaceId,
    ]);
    const mailer = createMemoryMailer();
    const job = spaceEmailJob({
      db: testDb.db,
      mailer,
      guestOrigin: 'http://guest.test',
      now: () => NOW,
    });
    const data = { purpose: 'recover' as const, spaceId: g.spaceId };
    await job.handler(data, { id: 'job-a' });
    await job.handler(data, { id: 'job-a' });
    expect(mailer.sent).toHaveLength(2);
    expect(mailer.sent[0]?.idempotencyKey).toBe('space-email:job-a');
    expect(mailer.sent[1]?.idempotencyKey).toBe(mailer.sent[0]?.idempotencyKey);
    expect(mailer.sent[0]?.text).toContain('http://guest.test/recover?token=');
  });

  it('logs ids only, never the email or the token', async () => {
    const g = await seedGuestUnit(testDb.db, { now: NOW });
    await testDb.pool.query('update spaces set email = $1, email_opt_in_at = $2 where id = $3', [
      'secret@example.test',
      NOW,
      g.spaceId,
    ]);
    const lines: string[] = [];
    const log = console.log;
    console.log = (line: string) => lines.push(line);
    const mailer = createMemoryMailer();
    try {
      await spaceEmailJob({
        db: testDb.db,
        mailer,
        guestOrigin: 'http://guest.test',
        now: () => NOW,
      }).handler({ purpose: 'verify_email', spaceId: g.spaceId }, { id: 'job-b' });
    } finally {
      console.log = log;
    }
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '{}')).toEqual({
      job: 'space-email',
      purpose: 'verify_email',
      spaceId: g.spaceId,
      outcome: 'sent',
    });
    const token = /token=([\w-]+)/.exec(mailer.sent[0]?.text ?? '')?.[1] ?? 'none';
    expect(lines[0]).not.toContain('secret@example.test');
    expect(lines[0]).not.toContain(token);
  });
});
