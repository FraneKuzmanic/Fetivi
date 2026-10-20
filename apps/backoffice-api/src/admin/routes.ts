import { accounts, actAsAudit, type Db, properties, units } from '@fetivi/domain';
import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { principalOf } from '../auth/plugin';
import { toMe } from '../auth/routes';
import { deleteSessionsOf, setActingAs } from '../auth/sessions';
import { HttpError } from '../http-error';
import { issueSlug } from '../properties/store';

export interface AdminDeps {
  db: Db;
  now: () => Date;
}

const IdParams = z.object({ id: z.uuid() });
const ActAsBody = z.object({ hostId: z.uuid() });
const PropertiesQuery = z.object({ status: z.enum(['pending', 'approved']).default('pending') });
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
    // The start record; the audit hook only logs once the session is already acting.
    // One transaction, so the session never acts without it.
    await db.transaction(async (tx) => {
      await tx.insert(actAsAudit).values({
        adminId: principal.account.id,
        hostId: host.id,
        hostEmail: host.email,
        method: 'POST',
        route: '/api/admin/act-as',
        statusCode: 200,
        createdAt: deps.now(),
      });
      await setActingAs(tx, principal.sessionId, host.id);
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

  app.get('/api/admin/properties', admin, async (request) => {
    const { status } = PropertiesQuery.parse(request.query);
    const rows = await db
      .select({
        id: properties.id,
        name: properties.name,
        city: properties.city,
        hostEmail: accounts.email,
        unitCount: sql<number>`(select count(*)::int from ${units} where ${units.propertyId} = ${properties.id})`,
        createdAt: properties.createdAt,
        approvedAt: properties.approvedAt,
      })
      .from(properties)
      .innerJoin(accounts, eq(properties.hostId, accounts.id))
      .where(
        status === 'pending' ? isNull(properties.approvedAt) : isNotNull(properties.approvedAt),
      )
      .orderBy(desc(properties.createdAt));
    return {
      properties: rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        approvedAt: r.approvedAt?.toISOString() ?? null,
      })),
    };
  });

  /** One-way and idempotent: approving again keeps the first approval and every slug. */
  app.post('/api/admin/properties/:id/approve', admin, async (request, reply) => {
    const principal = principalOf(request);
    const { id } = IdParams.parse(request.params);
    await db.transaction(async (tx) => {
      const [property] = await tx
        .select({ id: properties.id })
        .from(properties)
        .where(eq(properties.id, id))
        .for('update');
      if (!property) throw new HttpError(404, 'not-found');
      const now = deps.now();
      await tx
        .update(properties)
        .set({ approvedAt: now, approvedBy: principal.account.id, updatedAt: now })
        .where(and(eq(properties.id, id), isNull(properties.approvedAt)));
      const slugless = await tx
        .select({ id: units.id })
        .from(units)
        .where(and(eq(units.propertyId, id), isNull(units.qrSlug)));
      for (const unit of slugless) await issueSlug(tx, unit.id);
    });
    return reply.status(204).send();
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
