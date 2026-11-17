import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAdmin } from '../cli/create-admin';
import {
  createTestApp,
  del,
  get,
  loginAs,
  PASSWORD,
  post,
  put,
  signUpVerifiedHost,
  type TestApp,
} from '../testing';

let t: TestApp;
let hostCookie: string;
let adminCookie: string;

const NO_KEY = { source: 'none', last4: null, updatedAt: null, updatedBy: null };

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
    expect([before.statusCode, before.json()]).toEqual([
      200,
      { dailyMessageCap: 60, llmKey: NO_KEY },
    ]);

    const saved = await put(t.app, '/api/admin/settings', { dailyMessageCap: 25 }, adminCookie);
    expect([saved.statusCode, saved.json()]).toEqual([
      200,
      { dailyMessageCap: 25, llmKey: NO_KEY },
    ]);
    expect((await get(t.app, '/api/admin/settings', adminCookie)).json()).toEqual({
      dailyMessageCap: 25,
      llmKey: NO_KEY,
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
      llmKey: NO_KEY,
    });
  });
});

describe('/api/admin/settings/llm-key (68)', () => {
  const ENV_KEY = 'sk-ant-env-0123456789-wxyz';
  const SETTINGS_KEY = 'sk-ant-settings-0123456789-abcd';
  const REPLACED_KEY = 'sk-ant-replaced-0123456789-efgh';
  let k: TestApp;
  let kAdmin: string;
  let kHost: string;
  const checkLlmKey = vi.fn(async (key: string | undefined) =>
    key ? ({ ok: true } as const) : ({ ok: false, error: 'not-configured' } as const),
  );

  beforeAll(async () => {
    k = await createTestApp({ llmEnvKey: ENV_KEY, checkLlmKey });
    await signUpVerifiedHost(k, 'host@example.test');
    kHost = await loginAs(k, 'host@example.test');
    const created = await createAdmin(k.db, 'admin@example.test', PASSWORD);
    if (!created.ok) throw new Error('admin not created');
    kAdmin = await loginAs(k, 'admin@example.test');
  });

  afterAll(async () => {
    await k?.close();
  });

  it('is for the admin only', async () => {
    const url = '/api/admin/settings/llm-key';
    for (const cookie of [kHost, undefined]) {
      const status = cookie ? 403 : 401;
      expect((await put(k.app, url, { key: SETTINGS_KEY }, cookie)).statusCode).toBe(status);
      expect((await del(k.app, url, cookie)).statusCode).toBe(status);
      expect((await post(k.app, `${url}/test`, undefined, cookie)).statusCode).toBe(status);
    }
    expect(await k.llmKeys.get()).toBe(ENV_KEY);
  });

  it('shows the environment key by its last four characters only', async () => {
    const body = (await get(k.app, '/api/admin/settings', kAdmin)).json();
    expect(body.llmKey).toEqual({
      source: 'environment',
      last4: 'wxyz',
      updatedAt: null,
      updatedBy: null,
    });
    expect(JSON.stringify(body)).not.toContain(ENV_KEY);
  });

  it('saves, replaces and removes the key, never echoing it, and the app picks it up at once', async () => {
    const saved = await put(
      k.app,
      '/api/admin/settings/llm-key',
      { key: ` ${SETTINGS_KEY} ` },
      kAdmin,
    );
    const changed = { updatedAt: k.clock.now().toISOString(), updatedBy: 'admin@example.test' };
    expect([saved.statusCode, saved.json()]).toEqual([
      200,
      { source: 'settings', last4: 'abcd', ...changed },
    ]);
    expect(saved.body).not.toContain(SETTINGS_KEY);
    const settings = await get(k.app, '/api/admin/settings', kAdmin);
    expect(settings.json()).toEqual({
      dailyMessageCap: 60,
      llmKey: { source: 'settings', last4: 'abcd', ...changed },
    });
    expect(settings.body).not.toContain(SETTINGS_KEY);
    // AC 3: the same app, no restart.
    expect(await k.llmKeys.get()).toBe(SETTINGS_KEY);

    // The settings key wins over the environment key in the check.
    const tested = await post(k.app, '/api/admin/settings/llm-key/test', undefined, kAdmin);
    expect([tested.statusCode, tested.json()]).toEqual([200, { ok: true }]);
    expect(checkLlmKey).toHaveBeenLastCalledWith(SETTINGS_KEY);

    k.clock.advance(60_000);
    const replaced = await put(k.app, '/api/admin/settings/llm-key', { key: REPLACED_KEY }, kAdmin);
    expect(replaced.json()).toMatchObject({ source: 'settings', last4: 'efgh' });
    expect(await k.llmKeys.get()).toBe(REPLACED_KEY);

    // The cap and the key are independent.
    await put(k.app, '/api/admin/settings', { dailyMessageCap: 30 }, kAdmin);
    expect((await get(k.app, '/api/admin/settings', kAdmin)).json()).toMatchObject({
      dailyMessageCap: 30,
      llmKey: { source: 'settings', last4: 'efgh' },
    });

    k.clock.advance(60_000);
    const removed = await del(k.app, '/api/admin/settings/llm-key', kAdmin);
    expect([removed.statusCode, removed.json()]).toEqual([
      200,
      {
        source: 'environment',
        last4: 'wxyz',
        updatedAt: k.clock.now().toISOString(),
        updatedBy: 'admin@example.test',
      },
    ]);
    expect(await k.llmKeys.get()).toBe(ENV_KEY);
    expect((await get(k.app, '/api/admin/settings', kAdmin)).json()).toMatchObject({
      dailyMessageCap: 30,
    });
  });

  it('refuses a key that is too short, too long, has inner whitespace or comes with extras', async () => {
    for (const body of [
      { key: 'sk-ant-short' },
      { key: 'x'.repeat(301) },
      { key: 'sk-ant-0123456789 0123456789' },
      { key: SETTINGS_KEY, extra: true },
      { key: 1234567890123456 },
      {},
    ]) {
      const refused = await put(k.app, '/api/admin/settings/llm-key', body, kAdmin);
      expect([refused.statusCode, refused.json()]).toEqual([400, { error: 'invalid-input' }]);
    }
    expect((await get(k.app, '/api/admin/settings', kAdmin)).json().llmKey.source).toBe(
      'environment',
    );
  });
});

describe('/api/admin/settings/llm-key/test without any key (68)', () => {
  it('reports not-configured', async () => {
    const tested = await post(t.app, '/api/admin/settings/llm-key/test', undefined, adminCookie);
    expect([tested.statusCode, tested.json()]).toEqual([
      200,
      { ok: false, error: 'not-configured' },
    ]);
  });
});
