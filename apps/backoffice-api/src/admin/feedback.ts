import { adminAnswerStats, type Db } from '@fetivi/domain';
import type { FastifyInstance } from 'fastify';

export interface FeedbackStatsDeps {
  db: Db;
}

/** Answer feedback across all units, for the admin (43 AC 4). */
export async function feedbackStatsRoutes(
  app: FastifyInstance,
  deps: FeedbackStatsDeps,
): Promise<void> {
  app.get('/api/admin/feedback-stats', { config: { access: 'admin' } }, async () =>
    adminAnswerStats(deps.db),
  );
}
