import type { LlmKeyCheckResult } from '@fetivi/domain';
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

const NO_KEY = {
  source: 'none',
  provider: null,
  model: null,
  last4: null,
  updatedAt: null,
  updatedBy: null,
};

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

describe('/api/admin/settings/llm-key (68, 71)', () => {
  const ENV_KEY = 'sk-ant-env-0123456789-wxyz';
  const SETTINGS_KEY = 'sk-ant-settings-0123456789-abcd';
  const OPENAI_KEY = 'sk-proj-replaced-0123456789-efgh';
  let k: TestApp;
  let kAdmin: string;
  let kHost: string;
  const checkLlmKey = vi.fn(async (key: string | undefined): Promise<LlmKeyCheckResult> => {
    if (!key) return { ok: false, error: 'not-configured' };
    if (key.startsWith('sk-ant-')) {
      return { ok: true, provider: 'anthropic', models: ['claude-haiku-5-5', 'claude-sonnet-5-5'] };
    }
    if (key.startsWith('sk-proj-')) return { ok: true, provider: 'openai', models: ['gpt-5'] };
    return { ok: false, error: 'unrecognised' };
  });

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
      expect(
        (await put(k.app, url, { key: SETTINGS_KEY, model: 'claude-sonnet-5-5' }, cookie))
          .statusCode,
      ).toBe(status);
      expect((await post(k.app, `${url}/check`, { key: SETTINGS_KEY }, cookie)).statusCode).toBe(
        status,
      );
      expect((await del(k.app, url, cookie)).statusCode).toBe(status);
      expect((await post(k.app, `${url}/test`, undefined, cookie)).statusCode).toBe(status);
    }
    expect(await k.llmKeys.get()).toEqual({ provider: 'anthropic', key: ENV_KEY, model: null });
  });

  it('shows the environment key by its last four characters only', async () => {
    const body = (await get(k.app, '/api/admin/settings', kAdmin)).json();
    expect(body.llmKey).toEqual({
      source: 'environment',
      provider: 'anthropic',
      model: null,
      last4: 'wxyz',
      updatedAt: null,
      updatedBy: null,
    });
    expect(JSON.stringify(body)).not.toContain(ENV_KEY);
  });

  it('checks a typed key and lists its models, saving nothing', async () => {
    const checked = await post(
      k.app,
      '/api/admin/settings/llm-key/check',
      { key: OPENAI_KEY },
      kAdmin,
    );
    expect([checked.statusCode, checked.json()]).toEqual([
      200,
      { ok: true, provider: 'openai', models: ['gpt-5'] },
    ]);
    expect((await get(k.app, '/api/admin/settings', kAdmin)).json().llmKey.source).toBe(
      'environment',
    );
  });

  it('refuses a key no provider accepts and a model the provider does not list', async () => {
    const url = '/api/admin/settings/llm-key';
    const unknown = await put(k.app, url, { key: 'zz-0123456789-0123456789', model: 'm' }, kAdmin);
    expect([unknown.statusCode, unknown.json()]).toEqual([422, { error: 'unrecognised' }]);
    const wrong = await put(k.app, url, { key: SETTINGS_KEY, model: 'gpt-5' }, kAdmin);
    expect([wrong.statusCode, wrong.json()]).toEqual([422, { error: 'unknown-model' }]);
    // Only a model needs a saved key to apply to.
    const modelOnly = await put(k.app, url, { model: 'claude-sonnet-5-5' }, kAdmin);
    expect([modelOnly.statusCode, modelOnly.json()]).toEqual([409, { error: 'no-saved-key' }]);
  });

  it('saves, replaces and removes the key, never echoing it, and the app picks it up at once', async () => {
    const saved = await put(
      k.app,
      '/api/admin/settings/llm-key',
      { key: ` ${SETTINGS_KEY} `, model: 'claude-haiku-5-5' },
      kAdmin,
    );
    const changed = { updatedAt: k.clock.now().toISOString(), updatedBy: 'admin@example.test' };
    expect([saved.statusCode, saved.json()]).toEqual([
      200,
      {
        source: 'settings',
        provider: 'anthropic',
        model: 'claude-haiku-5-5',
        last4: 'abcd',
        ...changed,
      },
    ]);
    expect(saved.body).not.toContain(SETTINGS_KEY);
    const settings = await get(k.app, '/api/admin/settings', kAdmin);
    expect(settings.json()).toEqual({
      dailyMessageCap: 60,
      llmKey: {
        source: 'settings',
        provider: 'anthropic',
        model: 'claude-haiku-5-5',
        last4: 'abcd',
        ...changed,
      },
    });
    expect(settings.body).not.toContain(SETTINGS_KEY);
    // AC 3: the same app, no restart.
    expect(await k.llmKeys.get()).toEqual({
      provider: 'anthropic',
      key: SETTINGS_KEY,
      model: 'claude-haiku-5-5',
    });

    // The settings key wins over the environment key in the check.
    const tested = await post(k.app, '/api/admin/settings/llm-key/test', undefined, kAdmin);
    expect(tested.json()).toMatchObject({ ok: true, provider: 'anthropic' });
    expect(checkLlmKey).toHaveBeenLastCalledWith(SETTINGS_KEY);

    // Another model for the saved key, without pasting it again.
    const remodelled = await put(
      k.app,
      '/api/admin/settings/llm-key',
      { model: 'claude-sonnet-5-5' },
      kAdmin,
    );
    expect(remodelled.json()).toMatchObject({ model: 'claude-sonnet-5-5', last4: 'abcd' });
    expect((await k.llmKeys.get())?.model).toBe('claude-sonnet-5-5');

    // Another provider: every task now runs on its model.
    k.clock.advance(60_000);
    const replaced = await put(
      k.app,
      '/api/admin/settings/llm-key',
      { key: OPENAI_KEY, model: 'gpt-5' },
      kAdmin,
    );
    expect(replaced.json()).toMatchObject({
      source: 'settings',
      provider: 'openai',
      model: 'gpt-5',
      last4: 'efgh',
    });
    expect(await k.llmKeys.get()).toEqual({ provider: 'openai', key: OPENAI_KEY, model: 'gpt-5' });

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
        provider: 'anthropic',
        model: null,
        last4: 'wxyz',
        updatedAt: k.clock.now().toISOString(),
        updatedBy: 'admin@example.test',
      },
    ]);
    expect(await k.llmKeys.get()).toEqual({ provider: 'anthropic', key: ENV_KEY, model: null });
    expect((await get(k.app, '/api/admin/settings', kAdmin)).json()).toMatchObject({
      dailyMessageCap: 30,
    });
  });

  it('refuses a key that is too short, too long, has inner whitespace or comes with extras', async () => {
    for (const body of [
      { key: 'sk-ant-short', model: 'claude-sonnet-5-5' },
      { key: 'x'.repeat(301), model: 'claude-sonnet-5-5' },
      { key: 'sk-ant-0123456789 0123456789', model: 'claude-sonnet-5-5' },
      { key: SETTINGS_KEY, model: 'claude-sonnet-5-5', extra: true },
      { key: 1234567890123456, model: 'claude-sonnet-5-5' },
      { key: SETTINGS_KEY },
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
