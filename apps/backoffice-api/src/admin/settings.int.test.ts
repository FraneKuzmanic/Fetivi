import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdmin } from '../cli/create-admin';
import {
  createTestApp,
  get,
  loginAs,
  PASSWORD,
  put,
  signUpVerifiedHost,
  type TestApp,
} from '../testing';

let t: TestApp;
let hostCookie: string;
let adminCookie: string;

beforeAll(async () => {
  t = await createTestApp();
  await signUpVerifiedHost(t, 'host@example.test');
  hostCookie = await loginAs(t, 'host@example.test');
  const created = await createAdmin(t.db, 'admin@example.test', PASSWORD);
  if (!created.ok) throw new Error('admin not created');
  adminCookie = await loginAs(t, 'admin@example.test');
});

afterAll(async () => {
  await t?.close();
});

describe('/api/admin/settings', () => {
  it('is for the admin only', async () => {
    expect((await get(t.app, '/api/admin/settings', hostCookie)).statusCode).toBe(403);
    expect(
      (await put(t.app, '/api/admin/settings', { dailyMessageCap: 5 }, hostCookie)).statusCode,
    ).toBe(403);
    expect((await get(t.app, '/api/admin/settings')).statusCode).toBe(401);
  });

  it('defaults to 60, stores a new cap and refuses one outside 1–1000', async () => {
    const before = await get(t.app, '/api/admin/settings', adminCookie);
    expect([before.statusCode, before.json()]).toEqual([200, { dailyMessageCap: 60 }]);

    const saved = await put(t.app, '/api/admin/settings', { dailyMessageCap: 25 }, adminCookie);
    expect([saved.statusCode, saved.json()]).toEqual([200, { dailyMessageCap: 25 }]);
    expect((await get(t.app, '/api/admin/settings', adminCookie)).json()).toEqual({
      dailyMessageCap: 25,
    });

    for (const body of [
      { dailyMessageCap: 0 },
      { dailyMessageCap: 1001 },
      { dailyMessageCap: 2.5 },
      { dailyMessageCap: '30' },
      {},
      { dailyMessageCap: 30, extra: true },
    ]) {
      const refused = await put(t.app, '/api/admin/settings', body, adminCookie);
      expect([refused.statusCode, refused.json()]).toEqual([400, { error: 'invalid-input' }]);
    }
    expect((await get(t.app, '/api/admin/settings', adminCookie)).json()).toEqual({
      dailyMessageCap: 25,
    });
  });
});
