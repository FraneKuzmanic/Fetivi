import {
  type Db,
  dismissFinding,
  type JobQueue,
  latestRuns,
  listFindings,
  QUEUES,
} from '@fetivi/domain';
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
