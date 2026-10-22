import { createMemoryMailer, QUEUES, sendSpaceEmail, spaces } from '@fetivi/domain';
import { recordingQueue } from '@fetivi/domain/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { browser, createTestApp, seedLiveUnit, type TestApp } from '../testing';

const queue = recordingQueue();
let t: TestApp;

beforeAll(async () => {
  t = await createTestApp({ queue });
});

afterAll(async () => {
  await t?.close();
});

/** A device that entered the PIN, with its Space id. */
async function guest() {
  const { slug, pin, stay } = await seedLiveUnit(t.db);
  const device = browser(t.app);
  const entered = await device.write('POST', `/api/access/${slug}/pin`, { pin, language: 'en' });
  expect(entered.statusCode).toBe(201);
  const [space] = await t.db.select().from(spaces).where(eq(spaces.stayId, stay.id));
  if (!space) throw new Error('no space');
  return { device, spaceId: space.id, slug };
}

const jobsOf = (spaceId: string) =>
  queue.jobs.filter((j) => (j.data as { spaceId?: string }).spaceId === spaceId);

/** Runs the mail job as the jobs process would and returns the link's token. */
async function mailedToken(spaceId: string) {
  const mailer = createMemoryMailer();
  await sendSpaceEmail(
    { db: t.db, mailer, guestOrigin: 'http://app.test', now: t.clock.now },
    { purpose: 'verify_email', spaceId },
    `job-${spaceId}`,
  );
  const token = /\?token=([A-Za-z0-9_-]{43})/.exec(mailer.sent[0]?.text ?? '')?.[1];
  if (!token) throw new Error('no mail');
  return token;
}

describe('/api/email', () => {
  it('shows no email for a new Space', async () => {
    const { device } = await guest();
    const response = await device.get('/api/email');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ email: null, verified: false, tips: false });
  });

  it('stores the opt-in and queues one verification mail', async () => {
    const { device, spaceId } = await guest();
    const response = await device.write('POST', '/api/email', { email: ' Ana@Example.test ' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ email: 'ana@example.test', verified: false, tips: false });
    expect(jobsOf(spaceId)).toEqual([
      { name: QUEUES.spaceEmail, data: { purpose: 'verify_email', spaceId }, id: undefined },
    ]);
  });

  it('keeps the tips opt-in separate and off unless ticked', async () => {
    const { device } = await guest();
    const optIn = await device.write('POST', '/api/email', { email: 'a@example.test', tips: true });
    expect(optIn.json()).toMatchObject({ tips: true });
    const off = await device.write('PATCH', '/api/email', { tips: false });
    expect(off.json()).toMatchObject({ tips: false });
  });

  it('refuses tips and a resend without an email, and a bad address', async () => {
    const { device } = await guest();
    const tips = await device.write('PATCH', '/api/email', { tips: true });
    expect(tips.statusCode).toBe(409);
    expect(tips.json()).toEqual({ error: 'no-email' });
    expect((await device.write('POST', '/api/email/verification')).statusCode).toBe(409);
    expect((await device.write('POST', '/api/email', { email: 'nope' })).statusCode).toBe(400);
  });

  it('refuses an opt-in on a closed Space', async () => {
    const { device, spaceId } = await guest();
    await t.db
      .update(spaces)
      .set({ closedAt: new Date(t.clock.now().getTime() - 1000) })
      .where(eq(spaces.id, spaceId));
    const response = await device.write('POST', '/api/email', { email: 'a@example.test' });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'space-closed' });
  });

  it('verifies by the mailed link, on any device, once', async () => {
    const { device, spaceId } = await guest();
    await device.write('POST', '/api/email', { email: 'a@example.test' });
    const token = await mailedToken(spaceId);
    const other = browser(t.app);
    expect((await other.write('POST', '/api/email/verify', { token })).statusCode).toBe(204);
    expect((await device.get('/api/email')).json()).toMatchObject({ verified: true });
    const again = await other.write('POST', '/api/email/verify', { token });
    expect(again.statusCode).toBe(400);
    expect(again.json()).toEqual({ error: 'invalid-token' });
    // Confirmed: a resend sends nothing.
    const before = jobsOf(spaceId).length;
    expect((await device.write('POST', '/api/email/verification')).statusCode).toBe(202);
    expect(jobsOf(spaceId)).toHaveLength(before);
  });

  it('refuses a write without the app Origin', async () => {
    const { device } = await guest();
    const response = await device.write('POST', '/api/email', { email: 'a@example.test' }, null);
    expect(response.statusCode).toBe(403);
  });
});
