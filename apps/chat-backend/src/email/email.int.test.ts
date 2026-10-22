import {
  createMemoryMailer,
  QUEUES,
  sendSpaceEmail,
  spaces,
  tipsUnsubscribeToken,
} from '@fetivi/domain';
import { recordingQueue } from '@fetivi/domain/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  browser,
  createTestApp,
  seedLiveUnit,
  TEST_GUEST_LINK_SECRET,
  type TestApp,
  write,
} from '../testing';

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

describe('POST /api/email/tips/unsubscribe', () => {
  /** A verified address with the tip opt-in. */
  async function subscribed() {
    const g = await guest();
    await g.device.write('POST', '/api/email', { email: 'a@example.test', tips: true });
    expect((await g.device.get('/api/email')).json()).toMatchObject({ tips: true });
    const token = tipsUnsubscribeToken(TEST_GUEST_LINK_SECRET, g.spaceId);
    return { ...g, url: `/api/email/tips/unsubscribe?space=${g.spaceId}&token=${token}`, token };
  }

  /** The RFC 8058 POST a mail provider sends: form data, no Origin, no cookie. */
  const oneClick = (url: string) =>
    t.app.inject({
      method: 'POST',
      url,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'List-Unsubscribe=One-Click',
    });

  it('turns tips off from a one-click POST without an Origin, and again as a no-op', async () => {
    const { device, url } = await subscribed();
    expect((await oneClick(url)).statusCode).toBe(204);
    expect((await device.get('/api/email')).json()).toMatchObject({
      email: 'a@example.test',
      tips: false,
    });
    expect((await oneClick(url)).statusCode).toBe(204);
  });

  it('turns tips off from the guest page, on any device', async () => {
    const { device, spaceId, token } = await subscribed();
    const response = await write('POST', t.app, '/api/email/tips/unsubscribe', {
      space: spaceId,
      token,
    });
    expect(response.statusCode).toBe(204);
    expect((await device.get('/api/email')).json()).toMatchObject({ tips: false });
  });

  it("refuses a wrong token or another space's token, and changes nothing", async () => {
    const { device, spaceId } = await subscribed();
    const other = await subscribed();
    for (const url of [
      `/api/email/tips/unsubscribe?space=${spaceId}&token=${'a'.repeat(43)}`,
      `/api/email/tips/unsubscribe?space=${spaceId}&token=${other.token}`,
      `/api/email/tips/unsubscribe?space=${spaceId}`,
      '/api/email/tips/unsubscribe?space=nope&token=x',
    ]) {
      const response = await oneClick(url);
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'invalid-link' });
    }
    expect((await device.get('/api/email')).json()).toMatchObject({ tips: true });
  });

  it('answers 204 for an unknown space, revealing nothing', async () => {
    const space = '00000000-0000-4000-8000-000000000000';
    const token = tipsUnsubscribeToken(TEST_GUEST_LINK_SECRET, space);
    const response = await oneClick(`/api/email/tips/unsubscribe?space=${space}&token=${token}`);
    expect(response.statusCode).toBe(204);
  });

  it('keeps the Origin check on every other API write', async () => {
    const response = await t.app.inject({
      method: 'PATCH',
      url: '/api/email',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'tips=false',
    });
    expect(response.statusCode).toBe(403);
  });
});
