import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pushSubscriptions } from '../db/schema/notifications';
import { spaces, spaceTokens } from '../db/schema/spaces';
import { stays } from '../db/schema/stays';
import { QUEUES } from '../jobs/queue';
import { createTestDatabase, recordingQueue, seedGuestUnit, type TestDatabase } from '../testing';
import { hashToken, newToken } from '../tokens';
import { requestRecoveryBySlug, requestRecoveryForSpace, restoreSpace } from './recovery';
import { resolveSpace } from './store';
import { SPACE_READ_ONLY_DAYS, SPACE_RECOVERY_TTL_MS } from './vocabulary';

let testDb: TestDatabase;
const NOW = new Date('2026-10-19T10:00:00Z');
const DAY = 24 * 60 * 60_000;
const later = (ms: number, from = NOW) => new Date(from.getTime() + ms);

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb?.drop();
});

/** A seeded unit whose Space has a known cookie token and an opted-in email. */
async function seedSpace(email = 'guest@example.test') {
  const seeded = await seedGuestUnit(testDb.db, { now: NOW });
  const cookie = newToken();
  await testDb.db
    .update(spaces)
    .set({ email, emailOptInAt: NOW, tokenHash: hashToken(cookie) })
    .where(eq(spaces.id, seeded.spaceId));
  return { ...seeded, cookie, slug: seeded.private.qrSlug };
}

/** A recover token as the mail job would store it. */
async function issueRecoverToken(spaceId: string, email: string, now = NOW) {
  const token = newToken();
  await testDb.db.insert(spaceTokens).values({
    tokenHash: hashToken(token),
    spaceId,
    purpose: 'recover',
    email,
    createdAt: now,
    expiresAt: later(SPACE_RECOVERY_TTL_MS, now),
  });
  return token;
}

const recoverJob = (spaceId: string) => ({
  name: QUEUES.spaceEmail,
  data: { purpose: 'recover', spaceId },
  id: undefined,
});

describe('requestRecoveryBySlug', () => {
  it('queues a link for a matching email, case-insensitively', async () => {
    const { spaceId, slug } = await seedSpace();
    const queue = recordingQueue();
    await requestRecoveryBySlug(testDb.db, queue, {
      slug,
      email: ' Guest@Example.test',
      now: NOW,
    });
    expect(queue.jobs).toEqual([recoverJob(spaceId)]);
  });

  it('answers the same and queues nothing for an unknown email', async () => {
    const { slug } = await seedSpace();
    const queue = recordingQueue();
    await requestRecoveryBySlug(testDb.db, queue, { slug, email: 'x@example.test', now: NOW });
    expect(queue.jobs).toEqual([]);
  });

  it('refuses an unknown slug', async () => {
    await expect(
      requestRecoveryBySlug(testDb.db, recordingQueue(), {
        slug: 'nope',
        email: 'a@example.test',
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'not-found' });
  });

  it('picks the latest-created matching Space on the unit', async () => {
    const { stay, slug } = await seedSpace();
    const [newer] = await testDb.db
      .insert(spaces)
      .values({
        stayId: stay.id,
        tokenHash: hashToken(newToken()),
        language: 'en',
        closedAt: stay.activeUntil,
        email: 'guest@example.test',
        emailOptInAt: NOW,
        createdAt: later(1000),
        updatedAt: later(1000),
      })
      .returning();
    const queue = recordingQueue();
    await requestRecoveryBySlug(testDb.db, queue, {
      slug,
      email: 'guest@example.test',
      now: NOW,
    });
    expect(queue.jobs).toEqual([recoverJob(newer?.id ?? '')]);
  });
});

describe('requestRecoveryForSpace', () => {
  it('queues a link, or refuses without an opted-in email', async () => {
    const { spaceId } = await seedSpace();
    const queue = recordingQueue();
    await requestRecoveryForSpace(testDb.db, queue, { spaceId });
    expect(queue.jobs).toEqual([recoverJob(spaceId)]);

    const bare = await seedGuestUnit(testDb.db, { now: NOW });
    await expect(
      requestRecoveryForSpace(testDb.db, queue, { spaceId: bare.spaceId }),
    ).rejects.toMatchObject({ code: 'no-email' });
  });
});

describe('restoreSpace', () => {
  it('is single use: moves the Space to a new cookie and signs the old one out', async () => {
    const { spaceId, cookie } = await seedSpace();
    const token = await issueRecoverToken(spaceId, 'guest@example.test');
    const restored = await restoreSpace(testDb.db, { token, now: NOW });
    expect(restored.space.id).toBe(spaceId);
    expect(restored.closed).toBe(false);
    const resolved = await resolveSpace(testDb.db, restored.cookieToken, NOW);
    expect(resolved?.space.id).toBe(spaceId);
    expect(await resolveSpace(testDb.db, cookie, NOW)).toBeNull();
    await expect(restoreSpace(testDb.db, { token, now: NOW })).rejects.toMatchObject({
      code: 'invalid-token',
    });
  });

  it('expires after SPACE_RECOVERY_TTL_MS', async () => {
    const { spaceId } = await seedSpace();
    const token = await issueRecoverToken(spaceId, 'guest@example.test');
    await expect(
      restoreSpace(testDb.db, { token, now: later(SPACE_RECOVERY_TTL_MS) }),
    ).rejects.toMatchObject({ code: 'invalid-token' });
  });

  it('cannot restore a deleted space', async () => {
    const { spaceId, stayId } = await seedSpace();
    const token = await issueRecoverToken(spaceId, 'guest@example.test');
    await testDb.db.delete(stays).where(eq(stays.id, stayId));
    await expect(restoreSpace(testDb.db, { token, now: NOW })).rejects.toMatchObject({
      code: 'invalid-token',
    });
  });

  it('cannot attach to another Stay', async () => {
    const a = await seedSpace('same@example.test');
    const b = await seedSpace('same@example.test');

    // A's email at B's unit matches nothing: a Space is found only on its own unit.
    const queue = recordingQueue();
    await requestRecoveryBySlug(testDb.db, queue, {
      slug: b.slug,
      email: 'same@example.test',
      now: NOW,
    });
    expect(queue.jobs).toEqual([recoverJob(b.spaceId)]);

    const before = await testDb.db.$count(spaces);
    const [bBefore] = await testDb.db.select().from(spaces).where(eq(spaces.id, b.spaceId));
    const token = await issueRecoverToken(a.spaceId, 'same@example.test');
    const restored = await restoreSpace(testDb.db, { token, now: NOW });
    expect(restored.space.stayId).toBe(a.stayId);
    expect(await testDb.db.$count(spaces)).toBe(before);
    const [bAfter] = await testDb.db.select().from(spaces).where(eq(spaces.id, b.spaceId));
    expect(bAfter).toEqual(bBefore);
  });

  it('works through the read-only period and stops after it', async () => {
    const { spaceId, stay, slug } = await seedSpace();
    const closedAt = stay.activeUntil;
    const inside = later(SPACE_READ_ONLY_DAYS * DAY - 60_000, closedAt);

    const queue = recordingQueue();
    await requestRecoveryBySlug(testDb.db, queue, {
      slug,
      email: 'guest@example.test',
      now: inside,
    });
    expect(queue.jobs).toEqual([recoverJob(spaceId)]);
    const token = await issueRecoverToken(spaceId, 'guest@example.test', inside);
    expect((await restoreSpace(testDb.db, { token, now: inside })).closed).toBe(true);

    const past = later(SPACE_READ_ONLY_DAYS * DAY, closedAt);
    const quiet = recordingQueue();
    await requestRecoveryBySlug(testDb.db, quiet, {
      slug,
      email: 'guest@example.test',
      now: past,
    });
    expect(quiet.jobs).toEqual([]);
    const late = await issueRecoverToken(spaceId, 'guest@example.test', past);
    await expect(restoreSpace(testDb.db, { token: late, now: past })).rejects.toMatchObject({
      code: 'invalid-token',
    });
  });

  it('verifies a matching email and removes the old device push subscriptions', async () => {
    const { spaceId } = await seedSpace();
    await testDb.db.insert(pushSubscriptions).values({
      spaceId,
      endpoint: `https://push.example.test/${newToken()}`,
      p256dh: 'p',
      auth: 'a',
      createdAt: NOW,
    });
    const other = await issueRecoverToken(spaceId, 'guest@example.test');
    const token = await issueRecoverToken(spaceId, 'guest@example.test');
    const restored = await restoreSpace(testDb.db, { token, now: NOW });
    expect(restored.space.emailVerifiedAt).toEqual(NOW);
    expect(await testDb.db.$count(pushSubscriptions, eq(pushSubscriptions.spaceId, spaceId))).toBe(
      0,
    );
    await expect(restoreSpace(testDb.db, { token: other, now: NOW })).rejects.toMatchObject({
      code: 'invalid-token',
    });
  });

  it('leaves verification alone when the link went to an older address', async () => {
    const { spaceId } = await seedSpace();
    const token = await issueRecoverToken(spaceId, 'old@example.test');
    const restored = await restoreSpace(testDb.db, { token, now: NOW });
    expect(restored.space.emailVerifiedAt).toBeNull();
  });
});
