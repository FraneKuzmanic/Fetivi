import { recordModelUsage } from '@fetivi/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdmin } from '../cli/create-admin';
import {
  createTestApp,
  get,
  loginAs,
  PASSWORD,
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

describe('/api/admin/usage', () => {
  it('is for the admin only', async () => {
    expect((await get(t.app, '/api/admin/usage', hostCookie)).statusCode).toBe(403);
    expect((await get(t.app, '/api/admin/usage')).statusCode).toBe(401);
  });

  it('estimates today and this month by use', async () => {
    // The test clock starts at 2026-10-19T10:00Z.
    await recordModelUsage(
      t.db,
      'translation',
      {
        model: 'claude-sonnet-5-5',
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      new Date('2026-10-02T08:00:00Z'),
    );
    const res = await get(t.app, '/api/admin/usage', adminCookie);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pricesCheckedOn).toBe('2026-10-28');
    expect(body.unpricedCalls).toBe(0);
    expect(body.today.totalUsd).toBe(0);
    expect(body.today.byUse).toHaveLength(5);
    expect(body.month.totalUsd).toBe(2);
    expect(body.month.byUse.find((r: { use: string }) => r.use === 'translation')).toMatchObject({
      calls: 1,
      inputTokens: 1_000_000,
      costUsd: 2,
    });
  });
});
