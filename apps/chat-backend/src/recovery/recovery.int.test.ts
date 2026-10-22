import { createMemoryMailer, QUEUES, SPACE_COOKIE, sendSpaceEmail, spaces } from '@fetivi/domain';
import { recordingQueue } from '@fetivi/domain/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { browser, createTestApp, seedLiveUnit, type TestApp } from '../testing';

const queue = recordingQueue();
let t: TestApp;
const DAY = 24 * 60 * 60_000;

beforeAll(async () => {
  t = await createTestApp({ queue });
});

afterAll(async () => {
  await t?.close();
});

/** A device that entered the PIN and, unless `email` is null, opted in with it. */
async function guest(email: string | null = 'guest@example.test') {
  const { slug, pin, stay } = await seedLiveUnit(t.db);
  const device = browser(t.app);
  await device.write('POST', `/api/access/${slug}/pin`, { pin, language: 'en' });
  const [space] = await t.db.select().from(spaces).where(eq(spaces.stayId, stay.id));
  if (!space) throw new Error('no space');
  if (email) await device.write('POST', '/api/email', { email });
  return { device, spaceId: space.id, slug };
}

const recoverJobs = (spaceId: string) =>
  queue.jobs.filter((j) => {
    const data = j.data as { spaceId?: string; purpose?: string };
    return j.name === QUEUES.spaceEmail && data.spaceId === spaceId && data.purpose === 'recover';
  });

/** Runs the mail job as the jobs process would and returns the link's token. */
async function mailedToken(spaceId: string) {
  const mailer = createMemoryMailer();
  await sendSpaceEmail(
    { db: t.db, mailer, guestOrigin: 'http://app.test', now: t.clock.now },
    { purpose: 'recover', spaceId },
    `job-${spaceId}`,
  );
  const token = /\/recover\?token=([A-Za-z0-9_-]{43})/.exec(mailer.sent[0]?.text ?? '')?.[1];
  if (!token) throw new Error('no mail');
  return token;
}

describe('POST /api/access/:slug/recovery', () => {
  it('answers 202 alike for an unknown and a known email; only the known one queues', async () => {
    const { spaceId, slug } = await guest();
    const stranger = browser(t.app);
    const unknown = await stranger.write('POST', `/api/access/${slug}/recovery`, {
      email: 'nobody@example.test',
    });
    expect(unknown.statusCode).toBe(202);
    expect(recoverJobs(spaceId)).toHaveLength(0);
    const known = await stranger.write('POST', `/api/access/${slug}/recovery`, {
      email: 'GUEST@example.test',
    });
    expect(known.statusCode).toBe(202);
    expect(known.body).toBe(unknown.body);
    expect(recoverJobs(spaceId)).toHaveLength(1);
  });

  it('answers 404 for an unknown slug and 400 for a bad email', async () => {
    const stranger = browser(t.app);
    const unknownSlug = await stranger.write('POST', '/api/access/nope/recovery', {
      email: 'a@example.test',
    });
    expect(unknownSlug.statusCode).toBe(404);
    const { slug } = await guest();
    const bad = await stranger.write('POST', `/api/access/${slug}/recovery`, { email: 'x' });
    expect(bad.statusCode).toBe(400);
  });

  it('refuses a request without the app Origin', async () => {
    const { slug } = await guest();
    const response = await browser(t.app).write(
      'POST',
      `/api/access/${slug}/recovery`,
      { email: 'guest@example.test' },
      null,
    );
    expect(response.statusCode).toBe(403);
  });
});

describe('POST /api/recovery', () => {
  it('queues a link from Settings, or answers 409 without an email', async () => {
    const { device, spaceId } = await guest();
    expect((await device.write('POST', '/api/recovery')).statusCode).toBe(202);
    expect(recoverJobs(spaceId)).toHaveLength(1);
    const bare = await guest(null);
    const response = await bare.device.write('POST', '/api/recovery');
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'no-email' });
  });
});

describe('POST /api/recovery/restore', () => {
  it('moves the Space to the device that opens the link, once', async () => {
    const a = await guest();
    const token = await mailedToken(a.spaceId);
    const b = browser(t.app);
    const restored = await b.write('POST', '/api/recovery/restore', { token });
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({ closed: false, unitSlug: a.slug });
    const cookie = restored.cookies.find((c) => c.name === SPACE_COOKIE);
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, path: '/' });
    expect((await b.get('/api/space')).statusCode).toBe(200);
    expect((await b.get('/api/email')).json()).toMatchObject({ verified: true });

    const old = await a.device.get('/api/space');
    expect(old.statusCode).toBe(401);
    expect(a.device.jar.has(SPACE_COOKIE)).toBe(false);

    const again = await browser(t.app).write('POST', '/api/recovery/restore', { token });
    expect(again.statusCode).toBe(400);
    expect(again.json()).toEqual({ error: 'invalid-token' });
  });

  it('refuses a malformed token', async () => {
    const response = await browser(t.app).write('POST', '/api/recovery/restore', { token: 'x' });
    expect(response.statusCode).toBe(400);
  });

  it('works while the Space is closed, inside the read-only period', async () => {
    const a = await guest();
    await t.db
      .update(spaces)
      .set({ closedAt: new Date(t.clock.now().getTime() - 2 * DAY) })
      .where(eq(spaces.id, a.spaceId));
    expect((await a.device.write('POST', '/api/recovery')).statusCode).toBe(202);
    const token = await mailedToken(a.spaceId);
    const b = browser(t.app);
    const restored = await b.write('POST', '/api/recovery/restore', { token });
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({ closed: true });
    expect((await b.get('/api/space')).json()).toMatchObject({ closed: true });
  });
});
