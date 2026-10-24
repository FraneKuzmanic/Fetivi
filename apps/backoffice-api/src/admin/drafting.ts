import {
  type Db,
  DraftingRuleError,
  draftingStatus,
  type JobQueue,
  type RunSummary,
  startDraftingRun,
  startRefreshRun,
} from '@fetivi/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { principalOf } from '../auth/plugin';
import { HttpError } from '../http-error';

export interface DraftingDeps {
  db: Db;
  queue: JobQueue;
  now: () => Date;
}

const IdParams = z.object({ id: z.uuid() });

async function withDraftingErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof DraftingRuleError) {
      const status = { 'not-found': 404, 'run-running': 409, 'invalid-input': 400 }[error.code];
      throw new HttpError(status, error.code);
    }
    throw error;
  }
}

const runOut = (run: RunSummary | null) =>
  run && { ...run, startedAt: run.startedAt.toISOString() };

/**
 * Catalog drafting (42): the drafting status of a destination, "Draft waiting" for the
 * candidates left over a run's cap, and the admin-started pre-season refresh.
 */
export async function draftingRoutes(app: FastifyInstance, deps: DraftingDeps): Promise<void> {
  const { db, queue, now } = deps;
  const admin = { config: { access: 'admin' as const } };
  const base = '/api/admin/catalog/destinations/:id';

  app.get(`${base}/drafting`, admin, async (request) => {
    const { id } = IdParams.parse(request.params);
    const status = await withDraftingErrors(() => draftingStatus(db, id, now()));
    return { ...status, draft: runOut(status.draft), refresh: runOut(status.refresh) };
  });

  app.post(`${base}/drafting`, admin, async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    const principal = principalOf(request);
    const run = await withDraftingErrors(() =>
      db.transaction((tx) => startDraftingRun(tx, queue, id, principal.account.id, now())),
    );
    return reply.status(run.runId ? 202 : 200).send(run);
  });

  app.post(`${base}/refresh`, admin, async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    const principal = principalOf(request);
    const run = await withDraftingErrors(() =>
      startRefreshRun(db, queue, id, principal.account.id, now()),
    );
    return reply.status(run.runId ? 202 : 200).send(run);
  });
}
