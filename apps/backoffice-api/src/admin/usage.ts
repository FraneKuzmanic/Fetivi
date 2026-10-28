import { type Db, modelUsageEstimate } from '@fetivi/domain';
import type { FastifyInstance } from 'fastify';

export interface UsageDeps {
  db: Db;
  now: () => Date;
}

/** The admin's estimate of Fetivi's Anthropic spend, today and this month (UTC), by use (52 AC 5). */
export async function usageRoutes(app: FastifyInstance, deps: UsageDeps): Promise<void> {
  app.get('/api/admin/usage', { config: { access: 'admin' } }, async () =>
    modelUsageEstimate(deps.db, deps.now()),
  );
}
