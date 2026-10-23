import { reconciliationFindings, reconciliationRuns } from '@fetivi/domain';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdmin } from '../cli/create-admin';
import {
  createTestApp,
  get,
  loginAs,
  PASSWORD,
  post,
  signUpVerifiedHost,
  type TestApp,
} from '../testing';

let t: TestApp;
let hostCookie: string;
let adminId: string;
let adminCookie: string;
let openId: string;
let resolvedId: string;

const SEEN = new Date('2027-05-01T10:00:00Z');

beforeAll(async () => {
  t = await createTestApp();
  await signUpVerifiedHost(t, 'host@example.test');
  hostCookie = await loginAs(t, 'host@example.test');
  const created = await createAdmin(t.db, 'admin@example.test', PASSWORD);
  if (!created.ok) throw new Error('admin not created');
  adminId = created.id;
  adminCookie = await loginAs(t, 'admin@example.test');

  const [run] = await t.db
    .insert(reconciliationRuns)
    .values({ trigger: 'schedule', startedAt: SEEN, finishedAt: SEEN, checked: 3, found: 2 })
    .returning();
  if (!run) throw new Error('no run');
  const base = { runId: run.id, firstSeenAt: SEEN, lastSeenAt: SEEN };
  const rows = await t.db
    .insert(reconciliationFindings)
    .values([
      {
        ...base,
        kind: 'orphan_session',
        subject: 'session:acct_1:cs_1',
        stripeRef: 'cs_1',
        detail: 'status=complete intent=pi_1',
        status: 'needs_attention',
      },
      {
        ...base,
        kind: 'hold_expired',
        subject: 'hold:1',
        detail: 'hold expired',
        action: 'release: applied',
        status: 'resolved',
        resolvedAt: SEEN,
      },
    ])
    .returning();
  openId = rows[0]?.id as string;
  resolvedId = rows[1]?.id as string;
});

afterAll(async () => {
  await t?.close();
});

describe('admin reconciliation', () => {
  it('is for the admin only', async () => {
    expect((await get(t.app, '/api/admin/reconciliation')).statusCode).toBe(401);
    expect((await get(t.app, '/api/admin/reconciliation', hostCookie)).statusCode).toBe(403);
    expect((await post(t.app, '/api/admin/reconciliation/run', {}, hostCookie)).statusCode).toBe(
      403,
    );
  });

  it('lists runs and the findings of each tab', async () => {
    const open = await get(t.app, '/api/admin/reconciliation', adminCookie);
    expect(open.statusCode).toBe(200);
    expect(open.json().runs).toMatchObject([{ trigger: 'schedule', checked: 3, error: null }]);
    expect(open.json().findings.map((f: { id: string }) => f.id)).toEqual([openId]);
    expect(open.json().findings[0]).toMatchObject({
      kind: 'orphan_session',
      lastSeenAt: SEEN.toISOString(),
    });

    const done = await get(t.app, '/api/admin/reconciliation?status=resolved', adminCookie);
    expect(done.json().findings.map((f: { id: string }) => f.id)).toEqual([resolvedId]);
  });

  it('queues a run for the jobs process', async () => {
    const r = await post(t.app, '/api/admin/reconciliation/run', {}, adminCookie);
    expect(r.statusCode).toBe(202);
    const { rows } = await t.db.execute<{ data: { trigger: string; requestedBy: string } }>(
      sql`select data from pgboss.job where name = 'reconcile'`,
    );
    expect(rows.map((row) => row.data)).toEqual([{ trigger: 'admin', requestedBy: adminId }]);
  });

  it('marks a finding resolved once', async () => {
    const url = `/api/admin/reconciliation/findings/${openId}/resolve`;
    expect((await post(t.app, url, {}, adminCookie)).statusCode).toBe(204);
    const [row] = await t.db
      .select()
      .from(reconciliationFindings)
      .where(eq(reconciliationFindings.id, openId));
    expect(row).toMatchObject({ status: 'dismissed', resolvedBy: adminId });
    expect((await post(t.app, url, {}, adminCookie)).statusCode).toBe(404);
    const resolved = `/api/admin/reconciliation/findings/${resolvedId}/resolve`;
    expect((await post(t.app, resolved, {}, adminCookie)).statusCode).toBe(404);
  });
});
