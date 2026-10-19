import { accounts, actAsAudit, type Db } from '@fetivi/domain';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { principalOf } from '../auth/plugin';
import { toMe } from '../auth/routes';
import { deleteSessionsOf, setActingAs } from '../auth/sessions';
import { HttpError } from '../http-error';

export interface AdminDeps {
  db: Db;
  now: () => Date;
}

const IdParams = z.object({ id: z.uuid() });
const ActAsBody = z.object({ hostId: z.uuid() });
const AuditQuery = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) });

export async function adminRoutes(app: FastifyInstance, deps: AdminDeps): Promise<void> {
  const { db } = deps;
  const admin = { config: { access: 'admin' as const } };

  /** Only host accounts can be the target; an admin is never suspended, deleted or impersonated. */
  async function findHost(id: string) {
    const [host] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, id), eq(accounts.role, 'host')));
    if (!host) throw new HttpError(404, 'not-found');
    return host;
  }

  app.get('/api/admin/hosts', admin, async () => {
    const rows = await db
      .select()
      .from(accounts)
      .where(eq(accounts.role, 'host'))
      .orderBy(desc(accounts.createdAt));
    return {
      hosts: rows.map((r) => ({
        id: r.id,
        email: r.email,
        emailVerified: r.emailVerifiedAt !== null,
        suspended: r.suspendedAt !== null,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  });

  app.post('/api/admin/hosts/:id/suspend', admin, async (request, reply) => {
    const host = await findHost(IdParams.parse(request.params).id);
    if (!host.suspendedAt) {
      await db
        .update(accounts)
        .set({ suspendedAt: deps.now(), updatedAt: deps.now() })
        .where(eq(accounts.id, host.id));
    }
    await deleteSessionsOf(db, host.id);
    return reply.status(204).send();
  });

  app.post('/api/admin/hosts/:id/unsuspend', admin, async (request, reply) => {
    const host = await findHost(IdParams.parse(request.params).id);
    await db
      .update(accounts)
      .set({ suspendedAt: null, updatedAt: deps.now() })
      .where(eq(accounts.id, host.id));
    return reply.status(204).send();
  });

  app.delete('/api/admin/hosts/:id', admin, async (request, reply) => {
    const host = await findHost(IdParams.parse(request.params).id);
    // Sessions and tokens cascade; admin sessions acting as this host fall back to null.
    await db.delete(accounts).where(eq(accounts.id, host.id));
    return reply.status(204).send();
  });

  app.post('/api/admin/act-as', admin, async (request) => {
    const principal = principalOf(request);
    const host = await findHost(ActAsBody.parse(request.body).hostId);
    await setActingAs(db, principal.sessionId, host.id);
    // The start record; the audit hook only logs once the session is already acting.
    await db.insert(actAsAudit).values({
      adminId: principal.account.id,
      hostId: host.id,
      hostEmail: host.email,
      method: 'POST',
      route: '/api/admin/act-as',
      statusCode: 200,
      createdAt: deps.now(),
    });
    return toMe({ ...principal, actingAs: { id: host.id, email: host.email } });
  });

  // 'authenticated' because admin routes refuse an acting session; the audit hook logs this stop.
  app.post('/api/admin/act-as/stop', { config: { access: 'authenticated' } }, async (request) => {
    const principal = principalOf(request);
    if (principal.account.role !== 'admin' || !principal.actingAs) {
      throw new HttpError(403, 'forbidden');
    }
    await setActingAs(db, principal.sessionId, null);
    return toMe({ ...principal, actingAs: null });
  });

  app.get('/api/admin/audit', admin, async (request) => {
    const { limit } = AuditQuery.parse(request.query);
    const rows = await db
      .select()
      .from(actAsAudit)
      .orderBy(desc(actAsAudit.createdAt), desc(actAsAudit.id))
      .limit(limit);
    return { entries: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) };
  });
}
