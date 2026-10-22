import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spaces, spaceTokens } from '../db/schema/spaces';
import { QUEUES } from '../jobs/queue';
import { createTestDatabase, recordingQueue, seedGuestUnit, type TestDatabase } from '../testing';
import { hashToken, newToken } from '../tokens';
import {
  optInSpaceEmail,
  resendVerification,
  setTipsOptIn,
  spaceEmailState,
  verifySpaceEmail,
} from './email';
import { SpaceRuleError } from './store';
import { SPACE_VERIFY_TTL_MS } from './vocabulary';

let testDb: TestDatabase;
const NOW = new Date('2026-10-19T10:00:00Z');
const later = (ms: number) => new Date(NOW.getTime() + ms);

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb?.drop();
});

async function optIn(spaceId: string, email: string, now = NOW, tips?: boolean) {
  const queue = recordingQueue();
  await testDb.db.transaction((tx) => optInSpaceEmail(tx, queue, { spaceId, email, now, tips }));
  return queue.jobs;
}

async function spaceRow(spaceId: string) {
  const [row] = await testDb.db.select().from(spaces).where(eq(spaces.id, spaceId));
  if (!row) throw new Error('no space');
  return row;
}

/** A verify token as the mail job would store it. */
async function issueVerifyToken(spaceId: string, email: string, now = NOW) {
  const token = newToken();
  await testDb.db.insert(spaceTokens).values({
    tokenHash: hashToken(token),
    spaceId,
    purpose: 'verify_email',
    email,
    createdAt: now,
    expiresAt: new Date(now.getTime() + SPACE_VERIFY_TTL_MS),
  });
  return token;
}

describe('optInSpaceEmail', () => {
  it('stores a normalised email, keeps the first opt-in time and queues one verification', async () => {
    const { spaceId } = await seedGuestUnit(testDb.db, { now: NOW });
    const jobs = await optIn(spaceId, '  Guest@Example.TEST ');
    expect(jobs).toEqual([
      { name: QUEUES.spaceEmail, data: { purpose: 'verify_email', spaceId }, id: undefined },
    ]);
    const row = await spaceRow(spaceId);
    expect(row.email).toBe('guest@example.test');
    expect(row.emailOptInAt).toEqual(NOW);
    expect(row.tipsEmailOptInAt).toBeNull();

    expect(await optIn(spaceId, 'guest@example.test', later(1000))).toEqual([]);
    expect((await spaceRow(spaceId)).emailOptInAt).toEqual(NOW);
  });

  it('a new address clears verification, deletes old links and queues a new one', async () => {
    const { spaceId } = await seedGuestUnit(testDb.db, { now: NOW });
    await optIn(spaceId, 'old@example.test');
    const old = await issueVerifyToken(spaceId, 'old@example.test');
    await verifySpaceEmail(testDb.db, old, NOW);
    const stale = await issueVerifyToken(spaceId, 'old@example.test');

    const jobs = await optIn(spaceId, 'new@example.test', later(1000));
    expect(jobs).toHaveLength(1);
    const row = await spaceRow(spaceId);
    expect(row.email).toBe('new@example.test');
    expect(row.emailVerifiedAt).toBeNull();
    await expect(verifySpaceEmail(testDb.db, stale, later(2000))).rejects.toThrow(SpaceRuleError);
  });

  it('keeps tips unticked unless asked', async () => {
    const { spaceId } = await seedGuestUnit(testDb.db, { now: NOW });
    await optIn(spaceId, 'a@example.test');
    expect((await spaceEmailState(testDb.db, spaceId)).tips).toBe(false);
    await optIn(spaceId, 'a@example.test', NOW, true);
    expect((await spaceEmailState(testDb.db, spaceId)).tips).toBe(true);
    await setTipsOptIn(testDb.db, spaceId, false, NOW);
    expect((await spaceEmailState(testDb.db, spaceId)).tips).toBe(false);
  });
});

describe('spaceEmailState, setTipsOptIn and resendVerification', () => {
  it('shows no email until opted in, and refuses tips or a resend without one', async () => {
    const { spaceId } = await seedGuestUnit(testDb.db, { now: NOW });
    expect(await spaceEmailState(testDb.db, spaceId)).toEqual({
      email: null,
      verified: false,
      tips: false,
    });
    await expect(setTipsOptIn(testDb.db, spaceId, true, NOW)).rejects.toMatchObject({
      code: 'no-email',
    });
    await expect(resendVerification(testDb.db, recordingQueue(), spaceId)).rejects.toMatchObject({
      code: 'no-email',
    });
  });

  it('resends only while unverified', async () => {
    const { spaceId } = await seedGuestUnit(testDb.db, { now: NOW });
    await optIn(spaceId, 'a@example.test');
    const queue = recordingQueue();
    await resendVerification(testDb.db, queue, spaceId);
    expect(queue.jobs).toHaveLength(1);
    await verifySpaceEmail(testDb.db, await issueVerifyToken(spaceId, 'a@example.test'), NOW);
    await resendVerification(testDb.db, queue, spaceId);
    expect(queue.jobs).toHaveLength(1);
  });
});

describe('verifySpaceEmail', () => {
  it('verifies once; the same token again is invalid', async () => {
    const { spaceId } = await seedGuestUnit(testDb.db, { now: NOW });
    await optIn(spaceId, 'a@example.test');
    const token = await issueVerifyToken(spaceId, 'a@example.test');
    await verifySpaceEmail(testDb.db, token, later(1000));
    expect(await spaceEmailState(testDb.db, spaceId)).toMatchObject({ verified: true });
    expect((await spaceRow(spaceId)).emailVerifiedAt).toEqual(later(1000));
    await expect(verifySpaceEmail(testDb.db, token, later(2000))).rejects.toMatchObject({
      code: 'invalid-token',
    });
  });

  it('refuses an expired token', async () => {
    const { spaceId } = await seedGuestUnit(testDb.db, { now: NOW });
    await optIn(spaceId, 'a@example.test');
    const token = await issueVerifyToken(spaceId, 'a@example.test');
    await expect(
      verifySpaceEmail(testDb.db, token, later(SPACE_VERIFY_TTL_MS)),
    ).rejects.toMatchObject({ code: 'invalid-token' });
  });

  it('a link for an older address is spent without verifying the new one', async () => {
    const { spaceId } = await seedGuestUnit(testDb.db, { now: NOW });
    await optIn(spaceId, 'old@example.test');
    const token = await issueVerifyToken(spaceId, 'old@example.test');
    // Changed with the token row left in place, as if the mail was already on its way.
    await testDb.db.update(spaces).set({ email: 'new@example.test' }).where(eq(spaces.id, spaceId));
    await verifySpaceEmail(testDb.db, token, NOW);
    expect((await spaceRow(spaceId)).emailVerifiedAt).toBeNull();
    await expect(verifySpaceEmail(testDb.db, token, NOW)).rejects.toMatchObject({
      code: 'invalid-token',
    });
  });
});
