import {
  type Db,
  dismissCandidate,
  draftCandidates,
  type JobQueue,
  keepApart,
  listCandidates,
  mergeCandidates,
  restoreCandidate,
  SEEDING_CANDIDATE_STATUSES,
  SEEDING_LIMITS,
  SeedingRuleError,
  splitSourceRow,
  startImport,
} from '@fetivi/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { principalOf } from '../auth/plugin';
import { HttpError } from '../http-error';

export interface SeedingDeps {
  db: Db;
  queue: JobQueue;
  now: () => Date;
}

const IdParams = z.object({ id: z.uuid() });
const OverviewQuery = z.object({ status: z.enum(SEEDING_CANDIDATE_STATUSES).default('new') });
const DraftBody = z.object({
  candidateIds: z.array(z.uuid()).min(1).max(SEEDING_LIMITS.draftPerRequest),
});
const MergeBody = z.object({ intoId: z.uuid() });
const KeepApartBody = z.object({ otherId: z.uuid() });

const iso = (date: Date | null) => date?.toISOString() ?? null;

async function withSeedingErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof SeedingRuleError) {
      const status = {
        'not-found': 404,
        'invalid-state': 409,
        'import-running': 409,
        'invalid-input': 400,
      }[error.code];
      throw new HttpError(status, error.code);
    }
    throw error;
  }
}

/**
 * Catalog seeding (41): import a destination's candidate places from open data, review the
 * duplicates, and tick candidates to send them to drafting.
 */
export async function seedingRoutes(app: FastifyInstance, deps: SeedingDeps): Promise<void> {
  const { db, queue, now } = deps;
  const admin = { config: { access: 'admin' as const } };

  app.get('/api/admin/catalog/destinations/:id/seeding', admin, async (request) => {
    const { id } = IdParams.parse(request.params);
    const { status } = OverviewQuery.parse(request.query);
    const overview = await withSeedingErrors(() => listCandidates(db, id, status));
    const run = overview.lastImport;
    return {
      ...overview,
      lastImport: run && {
        id: run.id,
        status: run.status,
        startedAt: run.startedAt.toISOString(),
        finishedAt: iso(run.finishedAt),
        sources: run.sources,
      },
    };
  });

  app.post('/api/admin/catalog/destinations/:id/seeding/import', admin, async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    const principal = principalOf(request);
    const run = await withSeedingErrors(() =>
      startImport(db, queue, id, principal.account.id, now()),
    );
    return reply.status(202).send({ importId: run.id });
  });

  app.post('/api/admin/catalog/destinations/:id/seeding/draft', admin, async (request) => {
    const { id } = IdParams.parse(request.params);
    const { candidateIds } = DraftBody.parse(request.body);
    const principal = principalOf(request);
    return withSeedingErrors(() =>
      draftCandidates(db, id, candidateIds, principal.account.id, now()),
    );
  });

  app.post('/api/admin/seeding/candidates/:id/dismiss', admin, async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    await withSeedingErrors(() => dismissCandidate(db, id, now()));
    return reply.status(204).send();
  });

  app.post('/api/admin/seeding/candidates/:id/restore', admin, async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    await withSeedingErrors(() => restoreCandidate(db, id, now()));
    return reply.status(204).send();
  });

  app.post('/api/admin/seeding/candidates/:id/merge', admin, async (request) => {
    const { id } = IdParams.parse(request.params);
    const { intoId } = MergeBody.parse(request.body);
    return withSeedingErrors(() => mergeCandidates(db, id, intoId, now()));
  });

  app.post('/api/admin/seeding/candidates/:id/keep-apart', admin, async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    const { otherId } = KeepApartBody.parse(request.body);
    const principal = principalOf(request);
    await withSeedingErrors(() => keepApart(db, id, otherId, principal.account.id, now()));
    return reply.status(204).send();
  });

  app.post('/api/admin/seeding/sources/:id/split', admin, async (request) => {
    const { id } = IdParams.parse(request.params);
    const principal = principalOf(request);
    return withSeedingErrors(() => splitSourceRow(db, id, principal.account.id, now()));
  });
}
