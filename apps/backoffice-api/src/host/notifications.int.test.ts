import { accounts, hostPushSubscriptions } from '@fetivi/domain';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdmin } from '../cli/create-admin';
import {
  createTestApp,
  get,
  loginAs,
  PASSWORD,
  post,
  put,
  signUpVerifiedHost,
  TEST_ORIGIN,
  type TestApp,
} from '../testing';

const PUBLIC_KEY = 'BPublicVapidKeyForTests';
const KEYS = { p256dh: 'p256dh-key', auth: 'auth-key' };

let t: TestApp;
let hostA: { id: string; cookie: string };
let hostB: { id: string; cookie: string };
let adminCookie: string;

async function host(email: string) {
  await signUpVerifiedHost(t, email);
  const [row] = await t.db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.email, email));
  if (!row) throw new Error(`no account ${email}`);
  return { id: row.id, cookie: await loginAs(t, email) };
}

const subscribe = (endpoint: string, cookie: string) =>
  post(t.app, '/api/host/push/subscription', { endpoint, keys: KEYS }, cookie);

const unsubscribe = (endpoint: string, cookie: string) =>
  t.app.inject({
    method: 'DELETE',
    url: '/api/host/push/subscription',
    headers: { origin: TEST_ORIGIN, cookie },
    payload: { endpoint },
  });

const settingsOf = async (cookie: string) =>
  (await get(t.app, '/api/host/notification-settings', cookie)).json();

const ownerOf = async (endpoint: string) => {
  const [row] = await t.db
    .select({ accountId: hostPushSubscriptions.accountId })
    .from(hostPushSubscriptions)
    .where(eq(hostPushSubscriptions.endpoint, endpoint));
  return row?.accountId ?? null;
};

beforeAll(async () => {
  t = await createTestApp({ vapidPublicKey: PUBLIC_KEY });
  const created = await createAdmin(t.db, 'admin@example.test', PASSWORD);
  if (!created.ok) throw new Error('admin not created');
  adminCookie = await loginAs(t, 'admin@example.test');
  hostA = await host('a@example.test');
  hostB = await host('b@example.test');
});

afterAll(async () => {
  await t?.close();
});

describe('host notification settings', () => {
  it('returns the defaults, then what the host saved', async () => {
    expect(await settingsOf(hostA.cookie)).toEqual({
      mode: 'immediate',
      digestTimes: ['09:00', '14:00', '19:00'],
      timezone: 'Europe/Zagreb',
      push: { publicKey: PUBLIC_KEY, devices: 0 },
    });
    const saved = await put(
      t.app,
      '/api/host/notification-settings',
      { mode: 'digest', digestTimes: ['18:30', '08:00', '08:00'] },
      hostA.cookie,
    );
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ mode: 'digest', digestTimes: ['08:00', '18:30'] });
    expect(await settingsOf(hostA.cookie)).toMatchObject({
      mode: 'digest',
      digestTimes: ['08:00', '18:30'],
    });
    // Each host has their own settings.
    expect(await settingsOf(hostB.cookie)).toMatchObject({ mode: 'immediate' });
  });

  it('rejects an invalid time and more than six times', async () => {
    const save = (digestTimes: string[]) =>
      put(t.app, '/api/host/notification-settings', { mode: 'digest', digestTimes }, hostB.cookie);
    expect((await save(['24:00'])).json()).toEqual({ error: 'invalid-input' });
    expect((await save(['9:00'])).statusCode).toBe(400);
    expect((await save([])).statusCode).toBe(400);
    const seven = ['01:00', '02:00', '03:00', '04:00', '05:00', '06:00', '07:00'];
    expect((await save(seven)).statusCode).toBe(400);
  });

  it('needs a session', async () => {
    expect((await get(t.app, '/api/host/notification-settings')).statusCode).toBe(401);
    expect((await subscribe('https://fcm.googleapis.com/fcm/send/x', '')).statusCode).toBe(401);
  });

  it('lets an acting admin save settings for the host', async () => {
    await post(t.app, '/api/admin/act-as', { hostId: hostB.id }, adminCookie);
    try {
      const saved = await put(
        t.app,
        '/api/host/notification-settings',
        { mode: 'digest', digestTimes: ['10:00'] },
        adminCookie,
      );
      expect(saved.statusCode).toBe(200);
    } finally {
      await post(t.app, '/api/admin/act-as/stop', undefined, adminCookie);
    }
    expect(await settingsOf(hostB.cookie)).toMatchObject({ digestTimes: ['10:00'] });
  });
});

describe('host phone alerts', () => {
  it('stores a subscription, moves a shared device and deletes it', async () => {
    const endpoint = 'https://web.push.apple.com/QGx-apple-device';
    expect((await subscribe(endpoint, hostA.cookie)).statusCode).toBe(204);
    expect((await settingsOf(hostA.cookie)).push).toEqual({ publicKey: PUBLIC_KEY, devices: 1 });
    expect(await ownerOf(endpoint)).toBe(hostA.id);

    // The same phone, now signed in as host B.
    expect((await subscribe(endpoint, hostB.cookie)).statusCode).toBe(204);
    expect(await ownerOf(endpoint)).toBe(hostB.id);
    expect((await settingsOf(hostA.cookie)).push.devices).toBe(0);

    // Host A cannot remove host B's device; host B can.
    expect((await unsubscribe(endpoint, hostA.cookie)).statusCode).toBe(204);
    expect(await ownerOf(endpoint)).toBe(hostB.id);
    expect((await unsubscribe(endpoint, hostB.cookie)).statusCode).toBe(204);
    expect(await ownerOf(endpoint)).toBeNull();
  });

  it('accepts FCM and rejects other push services', async () => {
    expect(
      (await subscribe('https://fcm.googleapis.com/fcm/send/abc', hostA.cookie)).statusCode,
    ).toBe(204);
    for (const endpoint of ['http://web.push.apple.com/x', 'https://push.example.com/x']) {
      const response = await subscribe(endpoint, hostA.cookie);
      expect(response.statusCode).toBe(422);
      expect(response.json()).toEqual({ error: 'push-endpoint' });
    }
  });

  it('refuses a subscription from an admin acting as the host', async () => {
    await post(t.app, '/api/admin/act-as', { hostId: hostA.id }, adminCookie);
    try {
      const response = await subscribe('https://web.push.apple.com/admin-phone', adminCookie);
      expect(response.statusCode).toBe(403);
      expect((await settingsOf(adminCookie)).push.devices).toBe(0);
    } finally {
      await post(t.app, '/api/admin/act-as/stop', undefined, adminCookie);
    }
    expect(await ownerOf('https://web.push.apple.com/admin-phone')).toBeNull();
  });
});
