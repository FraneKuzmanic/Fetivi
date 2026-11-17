import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { accounts } from '../db/schema/accounts';
import { platformSettings } from '../db/schema/settings';
import { createTestDatabase, type TestDatabase } from '../testing';
import {
  createLlmKeySource,
  encryptLlmKey,
  getLlmKeyStatus,
  removeLlmKey,
  setLlmKey,
} from './llm-key';
import { getPlatformSettings, setDailyMessageCap } from './store';
import { DEFAULT_DAILY_MESSAGE_CAP } from './vocabulary';

let testDb: TestDatabase;
const NOW = new Date('2026-11-17T10:00:00Z');
const SECRET = 'integration-test-llm-key-secret-32-chars';
const ENV_KEY = 'sk-ant-env-key-for-the-fallback-wxyz';
const SETTINGS_KEY = 'sk-ant-settings-key-from-the-admin-abcd';

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb?.drop();
});

beforeEach(async () => {
  await testDb.db.delete(platformSettings);
});

async function seedAdmin(): Promise<{ id: string; email: string }> {
  const email = `admin-${randomUUID()}@example.test`;
  const [admin] = await testDb.db
    .insert(accounts)
    .values({ email, passwordHash: 'x', role: 'admin' })
    .returning({ id: accounts.id });
  if (!admin) throw new Error('no admin');
  return { id: admin.id, email };
}

const source = (envKey: string | undefined, extra: { now?: () => number } = {}) =>
  createLlmKeySource({ db: testDb.db, envKey, secret: SECRET, ...extra });

describe('llm key resolution', () => {
  it('is not configured with no setting and no env key', async () => {
    expect(await source(undefined).get()).toBeUndefined();
    expect(await source('').get()).toBeUndefined();
    expect(await getLlmKeyStatus(testDb.db, undefined)).toEqual({
      source: 'none',
      last4: null,
      updatedAt: null,
      updatedBy: null,
    });
  });

  it('uses the env key when the admin set none', async () => {
    expect(await source(ENV_KEY).get()).toBe(ENV_KEY);
    expect(await getLlmKeyStatus(testDb.db, ENV_KEY)).toEqual({
      source: 'environment',
      last4: 'wxyz',
      updatedAt: null,
      updatedBy: null,
    });
  });

  it('prefers the settings key over the env key', async () => {
    const admin = await seedAdmin();
    await setLlmKey(testDb.db, {
      key: SETTINGS_KEY,
      secret: SECRET,
      accountId: admin.id,
      now: NOW,
    });
    expect(await source(ENV_KEY).get()).toBe(SETTINGS_KEY);
    expect(await getLlmKeyStatus(testDb.db, ENV_KEY)).toEqual({
      source: 'settings',
      last4: 'abcd',
      updatedAt: NOW,
      updatedBy: admin.email,
    });
  });

  it('trims the key and rejects one that is too short or has inner whitespace', async () => {
    const admin = await seedAdmin();
    const save = (key: string) =>
      setLlmKey(testDb.db, { key, secret: SECRET, accountId: admin.id, now: NOW });
    await save(`  ${SETTINGS_KEY}\n`);
    expect(await source(undefined).get()).toBe(SETTINGS_KEY);
    await expect(save('sk-short')).rejects.toThrow(RangeError);
    await expect(save('sk-ant-has inner-whitespace-0000')).rejects.toThrow(RangeError);
    await expect(save('x'.repeat(301))).rejects.toThrow(RangeError);
  });

  it('keeps the cap and the key independent of each other', async () => {
    const admin = await seedAdmin();
    await setLlmKey(testDb.db, {
      key: SETTINGS_KEY,
      secret: SECRET,
      accountId: admin.id,
      now: NOW,
    });
    expect(await getPlatformSettings(testDb.db)).toEqual({
      dailyMessageCap: DEFAULT_DAILY_MESSAGE_CAP,
    });
    await setDailyMessageCap(testDb.db, 12, NOW);
    expect(await source(undefined).get()).toBe(SETTINGS_KEY);
    await setLlmKey(testDb.db, {
      key: `${SETTINGS_KEY}-new`,
      secret: SECRET,
      accountId: admin.id,
      now: NOW,
    });
    expect(await getPlatformSettings(testDb.db)).toEqual({ dailyMessageCap: 12 });
  });

  it('caches for the TTL, and invalidate makes a change immediate', async () => {
    const admin = await seedAdmin();
    let clock = 0;
    const keys = source(ENV_KEY, { now: () => clock });
    expect(await keys.get()).toBe(ENV_KEY);

    await setLlmKey(testDb.db, {
      key: SETTINGS_KEY,
      secret: SECRET,
      accountId: admin.id,
      now: NOW,
    });
    clock = 29_999;
    expect(await keys.get()).toBe(ENV_KEY);
    clock = 30_000;
    expect(await keys.get()).toBe(SETTINGS_KEY);

    await removeLlmKey(testDb.db, { accountId: admin.id, now: NOW });
    expect(await keys.get()).toBe(SETTINGS_KEY);
    keys.invalidate();
    expect(await keys.get()).toBe(ENV_KEY);
  });

  it('shares one read between concurrent gets', async () => {
    const select = vi.spyOn(testDb.db, 'select');
    try {
      const keys = source(ENV_KEY);
      expect(await Promise.all([keys.get(), keys.get(), keys.get()])).toEqual([
        ENV_KEY,
        ENV_KEY,
        ENV_KEY,
      ]);
      expect(select).toHaveBeenCalledTimes(1);
    } finally {
      select.mockRestore();
    }
  });

  it('falls back to the env key after a remove and still shows who removed it', async () => {
    const admin = await seedAdmin();
    await setLlmKey(testDb.db, {
      key: SETTINGS_KEY,
      secret: SECRET,
      accountId: admin.id,
      now: NOW,
    });
    const later = new Date('2026-11-18T08:00:00Z');
    await removeLlmKey(testDb.db, { accountId: admin.id, now: later });
    expect(await source(ENV_KEY).get()).toBe(ENV_KEY);
    expect(await getLlmKeyStatus(testDb.db, ENV_KEY)).toEqual({
      source: 'environment',
      last4: 'wxyz',
      updatedAt: later,
      updatedBy: admin.email,
    });
  });

  it('shows no email once the account that changed the key is deleted', async () => {
    const admin = await seedAdmin();
    await setLlmKey(testDb.db, {
      key: SETTINGS_KEY,
      secret: SECRET,
      accountId: admin.id,
      now: NOW,
    });
    await testDb.db.delete(accounts).where(eq(accounts.id, admin.id));
    expect(await getLlmKeyStatus(testDb.db, undefined)).toMatchObject({
      source: 'settings',
      updatedBy: null,
    });
  });

  it('reports a key under another secret and falls back to the env key', async () => {
    await testDb.db.insert(platformSettings).values({
      id: 1,
      dailyMessageCap: DEFAULT_DAILY_MESSAGE_CAP,
      updatedAt: NOW,
      llmKeyCiphertext: encryptLlmKey(SETTINGS_KEY, 'a-rotated-secret-that-no-longer-matches'),
      llmKeyLast4: 'abcd',
    });
    const onUnreadable = vi.fn();
    const keys = createLlmKeySource({
      db: testDb.db,
      envKey: ENV_KEY,
      secret: SECRET,
      onUnreadable,
    });
    expect(await keys.get()).toBe(ENV_KEY);
    expect(onUnreadable).toHaveBeenCalledWith();
  });

  it('stores only the ciphertext and the last four characters', async () => {
    const admin = await seedAdmin();
    await setLlmKey(testDb.db, {
      key: SETTINGS_KEY,
      secret: SECRET,
      accountId: admin.id,
      now: NOW,
    });
    const [row] = await testDb.db.select().from(platformSettings);
    expect(JSON.stringify(row)).not.toContain(SETTINGS_KEY);
    expect(JSON.stringify(row)).not.toContain(SETTINGS_KEY.slice(0, 12));
    expect(row?.llmKeyLast4).toBe('abcd');
  });
});
