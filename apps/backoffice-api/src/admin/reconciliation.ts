import {
  accounts,
  type Db,
  dismissFinding,
  type JobQueue,
  latestRuns,
  listFindings,
  offers,
  orders,
  providers,
  QUEUES,
  type ReconciliationFindingRow,
} from '@fetivi/domain';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { principalOf } from '../auth/plugin';
import { HttpError } from '../http-error';

export interface ReconciliationDeps {
  db: Db;
  queue: JobQueue;
  now: () => Date;
}

const IdParams = z.object({ id: z.uuid() });
const ListQuery = z.object({
  status: z.enum(['needs_attention', 'resolved']).default('needs_attention'),
});

const RUN_LIMIT = 5;
const FINDING_LIMIT = 200;

const iso = (date: Date | null) => date?.toISOString() ?? null;

type Subject = { kind: 'order' | 'provider' | 'payment'; id: string; label: string };

/**
 * What each finding is about, for the admin to read: its Order by the Offer's title, or for a
 * session no attempt knows (`session:<account>:<cs id>`), the Provider whose Stripe account it
 * is on, else the session on the host's account. Null when the Order is gone.
 */
async function subjectsOf(db: Db, findings: ReconciliationFindingRow[]) {
  const orderIds = [...new Set(findings.flatMap((f) => (f.orderId ? [f.orderId] : [])))];
  const accountOf = (f: ReconciliationFindingRow) =>
    f.subject.startsWith('session:') ? f.subject.split(':')[1] : undefined;
  const stripeIds = [...new Set(findings.flatMap((f) => accountOf(f) ?? []))];
  const [titles, providerRows, hostRows] = await Promise.all([
    orderIds.length === 0
      ? []
      : db
          .select({ id: orders.id, title: offers.title })
          .from(orders)
          .innerJoin(offers, eq(offers.id, orders.offerId))
          .where(inArray(orders.id, orderIds)),
    stripeIds.length === 0
      ? []
      : db
          .select({ id: providers.id, name: providers.name, stripe: providers.stripeAccountId })
          .from(providers)
          .where(inArray(providers.stripeAccountId, stripeIds)),
    stripeIds.length === 0
      ? []
      : db
          .select({ email: accounts.email, stripe: accounts.stripeAccountId })
          .from(accounts)
          .where(inArray(accounts.stripeAccountId, stripeIds)),
  ]);
  const titleOf = new Map(titles.map((r) => [r.id, r.title]));
  const providerOf = new Map(providerRows.map((r) => [r.stripe, r]));
  const hostOf = new Map(hostRows.map((r) => [r.stripe, r.email]));
  return (f: ReconciliationFindingRow): Subject | null => {
    const title = f.orderId ? titleOf.get(f.orderId) : undefined;
    if (f.orderId && title !== undefined) return { kind: 'order', id: f.orderId, label: title };
    const account = accountOf(f);
    if (!account) return null;
    const provider = providerOf.get(account);
    if (provider) return { kind: 'provider', id: provider.id, label: provider.name };
    return { kind: 'payment', id: f.stripeRef ?? f.subject, label: hostOf.get(account) ?? account };
  };
}

/**
 * The admin's view of the reconciliation job (34): recent runs and findings, a Run now that
 * enqueues the job (Stripe calls stay in the jobs process, ADR 0012), and Mark resolved.
 */
export async function reconciliationRoutes(
  app: FastifyInstance,
  deps: ReconciliationDeps,
): Promise<void> {
  const { db } = deps;
  const admin = { config: { access: 'admin' as const } };

  app.get('/api/admin/reconciliation', admin, async (request) => {
    const { status } = ListQuery.parse(request.query);
    const [runs, findings] = await Promise.all([
      latestRuns(db, RUN_LIMIT),
      listFindings(db, { status, limit: FINDING_LIMIT }),
    ]);
    const subjectOf = await subjectsOf(db, findings);
    return {
      runs: runs.map((r) => ({
        id: r.id,
        trigger: r.trigger,
        startedAt: r.startedAt.toISOString(),
        finishedAt: iso(r.finishedAt),
        checked: r.checked,
        found: r.found,
        resolved: r.resolved,
        error: r.error,
      })),
      findings: findings.map((f) => ({
        id: f.id,
        kind: f.kind,
        status: f.status,
        orderId: f.orderId,
        stripeRef: f.stripeRef,
        detail: f.detail,
        action: f.action,
        firstSeenAt: f.firstSeenAt.toISOString(),
        lastSeenAt: f.lastSeenAt.toISOString(),
        resolvedAt: iso(f.resolvedAt),
        subject: subjectOf(f),
      })),
    };
  });

  app.post('/api/admin/reconciliation/run', admin, async (request, reply) => {
    const principal = principalOf(request);
    await deps.queue.send(
      QUEUES.reconcile,
      { trigger: 'admin', requestedBy: principal.account.id },
      db,
    );
    return reply.status(202).send({ queued: true });
  });

  app.post('/api/admin/reconciliation/findings/:id/resolve', admin, async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    const principal = principalOf(request);
    if (!(await dismissFinding(db, id, principal.account.id, deps.now()))) {
      throw new HttpError(404, 'not-found');
    }
    return reply.status(204).send();
  });
}
