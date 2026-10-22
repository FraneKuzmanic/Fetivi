import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spaces, spaceTokens } from '../db/schema/spaces';
import { createMemoryMailer } from '../mail';
import { suppressEmail } from '../notifications/guest/suppressions';
import { createTestDatabase, seedGuestUnit, type TestDatabase } from '../testing';
import { hashToken } from '../tokens';
import { type SpaceEmailJobData, sendSpaceEmail } from './mail';
import { SPACE_EMAILS_PER_HOUR, SPACE_READ_ONLY_DAYS, type SpaceTokenPurpose } from './vocabulary';

let testDb: TestDatabase;
const NOW = new Date('2026-10-19T10:00:00Z');
const ORIGIN = 'https://guest.example.test';
const DAY = 24 * 60 * 60_000;

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb?.drop();
});

async function spaceWithEmail(email: string | null, language: 'en' | 'de' = 'en') {
  const seeded = await seedGuestUnit(testDb.db, { now: NOW, spaceLanguage: language });
  if (email) {
    await testDb.db
      .update(spaces)
      .set({ email, emailOptInAt: NOW })
      .where(eq(spaces.id, seeded.spaceId));
  }
  return seeded;
}

function send(spaceId: string, purpose: SpaceTokenPurpose, now = NOW, jobId = 'job-1') {
  const mailer = createMemoryMailer();
  const data: SpaceEmailJobData = { purpose, spaceId };
  const run = sendSpaceEmail(
    { db: testDb.db, mailer, guestOrigin: ORIGIN, now: () => now },
    data,
    jobId,
  );
  return { mailer, run };
}

const tokenIn = (text: string) => /\?token=([A-Za-z0-9_-]{43})/.exec(text)?.[1];

describe('sendSpaceEmail', () => {
  it.each([
    ['verify_email', '/verify-email'],
    ['recover', '/recover'],
  ] as const)('sends one %s mail whose link token is stored hashed', async (purpose, path) => {
    const { spaceId } = await spaceWithEmail('a@example.test', 'de');
    const { mailer, run } = send(spaceId, purpose);
    expect(await run).toBe('sent');
    expect(mailer.sent).toHaveLength(1);
    const mail = mailer.sent[0];
    expect(mail?.to).toBe('a@example.test');
    expect(mail?.idempotencyKey).toBe('space-email:job-1');
    expect(mail?.text).toContain(`${ORIGIN}${path}?token=`);
    expect(mail?.subject).toMatch(/Fetivi/);
    expect(mail?.subject).not.toMatch(/^Confirm|^Your link/); // German
    const token = tokenIn(mail?.text ?? '');
    expect(token).toBeDefined();
    const [row] = await testDb.db
      .select()
      .from(spaceTokens)
      .where(eq(spaceTokens.tokenHash, hashToken(token ?? '')));
    expect(row).toMatchObject({ spaceId, purpose, email: 'a@example.test' });
  });

  it('skips a Space without an opted-in email', async () => {
    const { spaceId } = await spaceWithEmail(null);
    const { mailer, run } = send(spaceId, 'recover');
    expect(await run).toBe('skipped');
    expect(mailer.sent).toHaveLength(0);
  });

  it('skips verification once verified', async () => {
    const { spaceId } = await spaceWithEmail('a@example.test');
    await testDb.db.update(spaces).set({ emailVerifiedAt: NOW }).where(eq(spaces.id, spaceId));
    expect(await send(spaceId, 'verify_email').run).toBe('skipped');
  });

  it('skips a suppressed address', async () => {
    const { spaceId } = await spaceWithEmail('bounced@example.test');
    await suppressEmail(testDb.db, 'bounced@example.test', 'bounced', NOW);
    expect(await send(spaceId, 'recover').run).toBe('skipped');
  });

  it('skips recovery past the read-only period', async () => {
    const { spaceId, stay } = await spaceWithEmail('a@example.test');
    const end = new Date(stay.activeUntil.getTime() + SPACE_READ_ONLY_DAYS * DAY);
    expect(await send(spaceId, 'recover', end).run).toBe('skipped');
    expect(await send(spaceId, 'recover', new Date(end.getTime() - 1)).run).toBe('sent');
  });

  it('sends at most SPACE_EMAILS_PER_HOUR per purpose in an hour', async () => {
    const { spaceId } = await spaceWithEmail('a@example.test');
    for (let i = 0; i < SPACE_EMAILS_PER_HOUR; i++) {
      expect(await send(spaceId, 'recover', NOW, `job-${i}`).run).toBe('sent');
    }
    expect(await send(spaceId, 'recover', NOW, 'job-x').run).toBe('skipped');
    expect(await send(spaceId, 'verify_email', NOW, 'job-y').run).toBe('sent');
    const nextHour = new Date(NOW.getTime() + 60 * 60_000 + 1);
    expect(await send(spaceId, 'recover', nextHour, 'job-z').run).toBe('sent');
    const rows = await testDb.db
      .select()
      .from(spaceTokens)
      .where(and(eq(spaceTokens.spaceId, spaceId), eq(spaceTokens.purpose, 'recover')));
    expect(rows).toHaveLength(SPACE_EMAILS_PER_HOUR + 1);
  });
});
