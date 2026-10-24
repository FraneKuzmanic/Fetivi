import {
  approveCurationItem,
  CatalogRuleError,
  CURATION_KINDS,
  CURATION_TABS,
  type CurationListItem,
  CurationRuleError,
  countCurationItems,
  curationItemActions,
  type Db,
  editCurationItem,
  getCurationItem,
  isReviewable,
  type JobQueue,
  listCurationItems,
  listStalenessQueue,
  markNeedsVisit,
  rejectCurationItem,
} from '@fetivi/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { principalOf } from '../auth/plugin';
import { HttpError } from '../http-error';

export interface CurationDeps {
  db: Db;
  queue: JobQueue;
  now: () => Date;
}

const IdParams = z.object({ id: z.uuid() });
const ListQuery = z.object({
  status: z.enum(CURATION_TABS).default('open'),
  kind: z.enum(CURATION_KINDS).optional(),
  destinationId: z.uuid().optional(),
});
const StalenessQuery = z.object({ destinationId: z.uuid().optional() });

const iso = (date: Date | null) => date?.toISOString() ?? null;

function itemOut(item: CurationListItem) {
  return {
    id: item.id,
    kind: item.kind,
    status: item.status,
    payload: item.payload,
    destination: item.destination,
    host: item.host,
    record: item.record && { ...item.record, verifiedAt: iso(item.record.verifiedAt) },
    candidate: item.candidate,
    drafted: item.drafted,
    // A candidate's draft offers Reject only until the drafting job (42) has filled it.
    actions: isReviewable(item.status)
      ? curationItemActions(item.kind, item.record !== null, item.drafted)
      : [],
    createdAt: item.createdAt.toISOString(),
    reviewedAt: iso(item.reviewedAt),
  };
}

async function withCurationErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof CurationRuleError) {
      const status = { 'not-found': 404, 'not-reviewable': 409, 'invalid-input': 400 }[error.code];
      throw new HttpError(status, error.code);
    }
    if (error instanceof CatalogRuleError) {
      throw new HttpError(error.code === 'not-found' ? 404 : 400, error.code);
    }
    throw error;
  }
}

/**
 * The admin curation queue (39): one list of items over six kinds with per-kind review actions,
 * and the staleness queue of records most likely to mislead guests.
 */
export async function curationRoutes(app: FastifyInstance, deps: CurationDeps): Promise<void> {
  const { db, now } = deps;
  const admin = { config: { access: 'admin' as const } };

  app.get('/api/admin/curation', admin, async (request) => {
    const { status, kind, destinationId } = ListQuery.parse(request.query);
    const [items, counts] = await Promise.all([
      listCurationItems(db, { status, kind, destinationId }),
      countCurationItems(db, { status, destinationId }),
    ]);
    return { items: items.map(itemOut), counts };
  });

  app.get('/api/admin/curation/staleness', admin, async (request) => {
    const { destinationId } = StalenessQuery.parse(request.query);
    const records = await listStalenessQueue(db, { now: now(), destinationId });
    return {
      records: records.map((r) => ({
        ...r,
        verifiedAt: iso(r.verifiedAt),
        staleness: { status: r.staleness.status, staleAt: iso(r.staleness.staleAt) },
      })),
    };
  });

  app.post('/api/admin/curation/:id/approve', admin, async (request) => {
    const { id } = IdParams.parse(request.params);
    const principal = principalOf(request);
    await withCurationErrors(() => approveCurationItem(deps, id, principal.account.id, now()));
    const item = await getCurationItem(db, id);
    if (!item) throw new HttpError(404, 'not-found');
    return itemOut(item);
  });

  app.post('/api/admin/curation/:id/edit', admin, async (request) => {
    const { id } = IdParams.parse(request.params);
    return withCurationErrors(() => editCurationItem(deps, id, now()));
  });

  app.post('/api/admin/curation/:id/reject', admin, async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    const principal = principalOf(request);
    await withCurationErrors(() => rejectCurationItem(db, id, principal.account.id, now()));
    return reply.status(204).send();
  });

  app.post('/api/admin/curation/:id/needs-visit', admin, async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    const principal = principalOf(request);
    await withCurationErrors(() => markNeedsVisit(db, id, principal.account.id, now()));
    return reply.status(204).send();
  });
}
