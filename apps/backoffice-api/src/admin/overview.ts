import {
  countCurationItems,
  type Db,
  listStalenessQueue,
  properties,
  reconciliationFindings,
} from '@fetivi/domain';
import { count, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { countOrdersNeedingAction } from './orders';

export interface AdminOverviewDeps {
  db: Db;
  now: () => Date;
}

const total = (counts: Record<string, number>) =>
  Object.values(counts).reduce((sum, n) => sum + n, 0);

/** The admin home: how much waits in each queue, by the same rules as the queue pages. */
export async function adminOverviewRoutes(
  app: FastifyInstance,
  deps: AdminOverviewDeps,
): Promise<void> {
  const { db } = deps;

  app.get('/api/admin/overview', { config: { access: 'admin' } }, async () => {
    const now = deps.now();
    const [pending, curationOpen, curationNeedsVisit, records, findings, ordersNeedAction] =
      await Promise.all([
        db.select({ n: count() }).from(properties).where(isNull(properties.approvedAt)),
        countCurationItems(db, { status: 'open' }),
        countCurationItems(db, { status: 'needs_visit' }),
        listStalenessQueue(db, { now, limit: Number.POSITIVE_INFINITY }),
        db
          .select({ n: count() })
          .from(reconciliationFindings)
          .where(eq(reconciliationFindings.status, 'needs_attention')),
        countOrdersNeedingAction(db, now),
      ]);
    return {
      approvalsPending: pending[0]?.n ?? 0,
      curationOpen: total(curationOpen),
      curationNeedsVisit: total(curationNeedsVisit),
      recordsDue: records.length,
      paymentProblems: findings[0]?.n ?? 0,
      ordersNeedAction,
    };
  });
}
