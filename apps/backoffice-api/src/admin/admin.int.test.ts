import { accounts, actAsAudit } from '@fetivi/domain';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
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

const probeRuns: string[] = [];

// Stands in for the host write routes that arrive with ticket 03.
async function probeRoutes(app: FastifyInstance) {
  app.post('/api/host/probe', { config: { access: 'host' } }, async (request) => {
    probeRuns.push(request.auth.hostId ?? '');
    return { hostId: request.auth.hostId };
  });
}

let t: TestApp;
let hostA: { id: string; cookie: string };
let hostB: { id: string; cookie: string };
let adminId: string;
let adminCookie: string;

const ADMIN_EMAIL = 'admin@example.test';

async function idOf(email: string) {
  const [row] = await t.db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.email, email));
  if (!row) throw new Error(`no account ${email}`);
  return row.id;
}

beforeAll(async () => {
  t = await createTestApp({ extraRoutes: probeRoutes });
  await signUpVerifiedHost(t, 'a@example.test');
  await signUpVerifiedHost(t, 'b@example.test');
  hostA = { id: await idOf('a@example.test'), cookie: await loginAs(t, 'a@example.test') };
  hostB = { id: await idOf('b@example.test'), cookie: await loginAs(t, 'b@example.test') };
  const created = await createAdmin(t.db, ADMIN_EMAIL, PASSWORD);
  if (!created.ok) throw new Error('admin not created');
  adminId = created.id;
  adminCookie = await loginAs(t, ADMIN_EMAIL);
});

afterAll(async () => {
  await t?.close();
});

describe('role matrix', () => {
  it('refuses anonymous requests to host and admin routes', async () => {
    for (const url of ['/api/host/account', '/api/admin/hosts']) {
      const r = await get(t.app, url);
      expect(r.statusCode).toBe(401);
      expect(r.json()).toEqual({ error: 'unauthenticated' });
    }
  });

  it('keeps hosts out of admin routes and admins out of host routes', async () => {
    const host = await get(t.app, '/api/admin/hosts', hostA.cookie);
    expect(host.statusCode).toBe(403);
    expect(host.json()).toEqual({ error: 'forbidden' });
    const admin = await get(t.app, '/api/host/account', adminCookie);
    expect(admin.statusCode).toBe(403);
  });

  it('scopes every host to their own account, whatever the client sends', async () => {
    expect((await get(t.app, '/api/host/account', hostA.cookie)).json()).toEqual({
      id: hostA.id,
      email: 'a@example.test',
    });
    expect((await get(t.app, '/api/host/account', hostB.cookie)).json().id).toBe(hostB.id);
    const smuggled = await get(t.app, `/api/host/account?hostId=${hostB.id}`, hostA.cookie);
    expect(smuggled.json().id).toBe(hostA.id);
  });

  it('lists hosts for the admin, newest first, without admins', async () => {
    const r = await get(t.app, '/api/admin/hosts', adminCookie);
    expect(r.statusCode).toBe(200);
    const emails = r.json().hosts.map((h: { email: string }) => h.email);
    expect(emails).toEqual(['b@example.test', 'a@example.test']);
  });
});

describe('act as host', () => {
  it('resolves host routes to the acting host and logs every write', async () => {
    const start = await post(t.app, '/api/admin/act-as', { hostId: hostA.id }, adminCookie);
    expect(start.statusCode).toBe(200);
    expect(start.json().actingAs).toEqual({ id: hostA.id, email: 'a@example.test' });

    const me = await get(t.app, '/api/auth/me', adminCookie);
    expect(me.json().actingAs.id).toBe(hostA.id);
    expect((await get(t.app, '/api/host/account', adminCookie)).json().id).toBe(hostA.id);

    const blocked = await get(t.app, '/api/admin/hosts', adminCookie);
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toEqual({ error: 'stop-acting-first' });

    const write = await post(t.app, '/api/host/probe', {}, adminCookie);
    expect(write.json()).toEqual({ hostId: hostA.id });

    const stop = await post(t.app, '/api/admin/act-as/stop', undefined, adminCookie);
    expect(stop.statusCode).toBe(200);
    expect(stop.json().actingAs).toBeNull();

    const audit = await get(t.app, '/api/admin/audit', adminCookie);
    const entries = audit.json().entries;
    expect(entries.map((e: { route: string }) => e.route)).toEqual([
      '/api/admin/act-as/stop',
      '/api/host/probe',
      '/api/admin/act-as',
    ]);
    for (const entry of entries) {
      expect(entry).toMatchObject({
        adminId,
        hostId: hostA.id,
        hostEmail: 'a@example.test',
        method: 'POST',
        statusCode: 200,
      });
    }
  });

  it('does not log reads made while acting', async () => {
    await post(t.app, '/api/admin/act-as', { hostId: hostA.id }, adminCookie);
    await get(t.app, '/api/host/account', adminCookie);
    await post(t.app, '/api/admin/act-as/stop', undefined, adminCookie);
    const [row] = await t.db.select({ n: sql<number>`count(*)::int` }).from(actAsAudit);
    expect(row?.n).toBe(5);
  });

  it('refuses act-as stop when not acting', async () => {
    expect((await post(t.app, '/api/admin/act-as/stop', undefined, adminCookie)).statusCode).toBe(
      403,
    );
    expect((await post(t.app, '/api/admin/act-as/stop', undefined, hostA.cookie)).statusCode).toBe(
      403,
    );
  });
});

describe('suspend and delete', () => {
  it('suspends a host: live session ends, login refused, admin can still act as them', async () => {
    const r = await post(t.app, `/api/admin/hosts/${hostA.id}/suspend`, undefined, adminCookie);
    expect(r.statusCode).toBe(204);
    expect((await get(t.app, '/api/auth/me', hostA.cookie)).statusCode).toBe(401);

    const login = await post(t.app, '/api/auth/login', {
      email: 'a@example.test',
      password: PASSWORD,
    });
    expect(login.statusCode).toBe(403);
    expect(login.json()).toEqual({ error: 'account-suspended' });

    const [row] = await t.db.select().from(accounts).where(eq(accounts.id, hostA.id));
    expect(row?.suspendedAt).not.toBeNull();

    const act = await post(t.app, '/api/admin/act-as', { hostId: hostA.id }, adminCookie);
    expect(act.statusCode).toBe(200);
    await post(t.app, '/api/admin/act-as/stop', undefined, adminCookie);

    const unsuspend = await post(
      t.app,
      `/api/admin/hosts/${hostA.id}/unsuspend`,
      undefined,
      adminCookie,
    );
    expect(unsuspend.statusCode).toBe(204);
    hostA.cookie = await loginAs(t, 'a@example.test');
  });

  it('deletes a host but keeps the audit rows; acting sessions fall back', async () => {
    const otherAdmin = await loginAs(t, ADMIN_EMAIL);
    await post(t.app, '/api/admin/act-as', { hostId: hostB.id }, otherAdmin);
    await post(t.app, '/api/host/probe', {}, otherAdmin);

    const del = await t.app.inject({
      method: 'DELETE',
      url: `/api/admin/hosts/${hostB.id}`,
      headers: { origin: 'http://host.test', cookie: adminCookie },
    });
    expect(del.statusCode).toBe(204);

    const login = await post(t.app, '/api/auth/login', {
      email: 'b@example.test',
      password: PASSWORD,
    });
    expect(login.statusCode).toBe(401);
    const rows = await t.db.select().from(actAsAudit).where(eq(actAsAudit.hostId, hostB.id));
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect((await get(t.app, '/api/auth/me', otherAdmin)).json().actingAs).toBeNull();
  });

  it('never targets an admin and validates ids', async () => {
    const self = await post(t.app, `/api/admin/hosts/${adminId}/suspend`, undefined, adminCookie);
    expect(self.statusCode).toBe(404);
    const second = await createAdmin(t.db, 'admin2@example.test', PASSWORD);
    if (!second.ok) throw new Error('admin2 not created');
    const other = await post(
      t.app,
      `/api/admin/hosts/${second.id}/suspend`,
      undefined,
      adminCookie,
    );
    expect(other.statusCode).toBe(404);
    const actAdmin = await post(t.app, '/api/admin/act-as', { hostId: second.id }, adminCookie);
    expect(actAdmin.statusCode).toBe(404);

    const bad = await post(t.app, '/api/admin/hosts/not-a-uuid/suspend', undefined, adminCookie);
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ error: 'invalid-input' });
  });

  it('createAdmin reports a taken email', async () => {
    expect(await createAdmin(t.db, ADMIN_EMAIL, PASSWORD)).toEqual({
      ok: false,
      code: 'email-taken',
    });
  });
});

// Last: it drops the audit table of this file's database.
describe('audit before write', () => {
  it('does not start acting when the start record cannot be written', async () => {
    await t.db.execute(sql`alter table act_as_audit rename to act_as_audit_off`);
    try {
      const r = await post(t.app, '/api/admin/act-as', { hostId: hostA.id }, adminCookie);
      expect(r.statusCode).toBe(500);
    } finally {
      await t.db.execute(sql`alter table act_as_audit_off rename to act_as_audit`);
    }
    expect((await get(t.app, '/api/auth/me', adminCookie)).json().actingAs).toBeNull();
  });

  it('fails the request without running the handler when the audit insert fails', async () => {
    await post(t.app, '/api/admin/act-as', { hostId: hostA.id }, adminCookie);
    await t.db.execute(sql`drop table act_as_audit`);
    const runsBefore = probeRuns.length;

    const r = await post(t.app, '/api/host/probe', {}, adminCookie);
    expect(r.statusCode).toBe(500);
    expect(r.json()).toEqual({ error: 'internal' });
    expect(probeRuns.length).toBe(runsBefore);
  });
});
