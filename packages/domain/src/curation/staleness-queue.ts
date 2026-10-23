import { and, eq, gte, ne, sql } from 'drizzle-orm';
import { budgetUsed, type Staleness, stalenessOf } from '../catalog/staleness';
import type { CatalogKind, PlaceCategory } from '../catalog/vocabulary';
import type { Executor } from '../db/client';
import { catalogRecommendations, catalogRecords, destinations } from '../db/schema/catalog';
import {
  RECOMMENDATION_WINDOW_DAYS,
  STALENESS_NEAR_DAYS,
  STALENESS_QUEUE_LIMIT,
} from './vocabulary';

const DAY_MS = 86_400_000;

export interface StalenessQueueRecord {
  id: string;
  destinationId: string;
  destinationName: string;
  kind: CatalogKind;
  placeCategory: PlaceCategory | null;
  title: string;
  verifiedAt: Date | null;
  staleness: Staleness;
  /** Recommendations in the last RECOMMENDATION_WINDOW_DAYS days. */
  recommendations: number;
  /** Budget used × (1 + recommendations). */
  score: number;
}

/**
 * Records past or within STALENESS_NEAR_DAYS of their staleness budget (never-verified ones
 * count as past it), ranked by budget used × (1 + recommendations) (39 AC 3). Events expire
 * rather than go stale and are left out.
 */
export async function listStalenessQueue(
  db: Executor,
  options: { now: Date; destinationId?: string; limit?: number },
): Promise<StalenessQueueRecord[]> {
  const { now, limit = STALENESS_QUEUE_LIMIT } = options;
  // `day` is a date in the destination's zone; a UTC cut-off can be off by one day at the
  // window's edge, which does not matter for a ranking.
  const since = new Date(now.getTime() - RECOMMENDATION_WINDOW_DAYS * DAY_MS)
    .toISOString()
    .slice(0, 10);
  const recent = db
    .select({
      recordId: catalogRecommendations.recordId,
      total: sql<number>`sum(${catalogRecommendations.count})::int`.as('total'),
    })
    .from(catalogRecommendations)
    .where(gte(catalogRecommendations.day, since))
    .groupBy(catalogRecommendations.recordId)
    .as('recent');
  const where = [ne(catalogRecords.kind, 'event')];
  if (options.destinationId) where.push(eq(catalogRecords.destinationId, options.destinationId));
  const rows = await db
    .select({
      id: catalogRecords.id,
      destinationId: catalogRecords.destinationId,
      destinationName: destinations.name,
      kind: catalogRecords.kind,
      placeCategory: catalogRecords.placeCategory,
      title: catalogRecords.title,
      verifiedAt: catalogRecords.verifiedAt,
      createdAt: catalogRecords.createdAt,
      recommendations: sql<number>`coalesce(${recent.total}, 0)`.mapWith(Number),
    })
    .from(catalogRecords)
    .innerJoin(destinations, eq(destinations.id, catalogRecords.destinationId))
    .leftJoin(recent, eq(recent.recordId, catalogRecords.id))
    .where(and(...where));

  const queue: (StalenessQueueRecord & { used: number })[] = [];
  for (const { createdAt, ...row } of rows) {
    const budget = budgetUsed({ ...row, createdAt }, now);
    if (budget === null) continue;
    const { used, days } = budget;
    if (row.verifiedAt !== null && used < 1 - STALENESS_NEAR_DAYS / days) continue;
    queue.push({
      ...row,
      staleness: stalenessOf({ ...row, endsAt: null }, now),
      score: used * (1 + row.recommendations),
      used,
    });
  }
  queue.sort((a, b) => b.score - a.score || b.used - a.used || a.title.localeCompare(b.title));
  return queue.slice(0, limit).map(({ used: _used, ...r }) => r);
}
