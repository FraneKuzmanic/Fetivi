import type { Egress } from '@fetivi/egress';
import { and, eq, gt, lte } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { destinations } from '../../db/schema/catalog';
import { type SeedingImportRow, seedingImports } from '../../db/schema/seeding';
import { type JobQueue, QUEUES, uuidFrom } from '../../jobs/queue';
import { fetchBathingWater, parseBathingWater } from './bathing-water';
import { SeedingRuleError, SourceError } from './errors';
import { fetchOverpass, parseOverpass } from './osm';
import { parseOvertureRows, readOvertureRows } from './overture';
import { groupUnassigned, upsertSourceRows } from './store';
import type { ImportArea, ParseResult } from './types';
import {
  SEEDING_LIMITS,
  SEEDING_SOURCES,
  type SeedingImportStatus,
  type SeedingSource,
  type SourceRunResult,
} from './vocabulary';

/**
 * Starts an open-data import for a destination and queues its job. One runs at a time; a run
 * still `running` after `importStaleMinutes` is stale, marked failed, and no longer blocks.
 */
export async function startImport(
  db: Db,
  queue: JobQueue,
  destinationId: string,
  adminId: string,
  now: Date,
): Promise<SeedingImportRow> {
  return db.transaction(async (tx) => {
    // Locking the destination serialises concurrent starts for it.
    const [destination] = await tx
      .select({ id: destinations.id })
      .from(destinations)
      .where(eq(destinations.id, destinationId))
      .for('update');
    if (!destination) throw new SeedingRuleError('not-found');
    const staleBefore = new Date(now.getTime() - SEEDING_LIMITS.importStaleMinutes * 60_000);
    const running = and(
      eq(seedingImports.destinationId, destinationId),
      eq(seedingImports.status, 'running'),
    );
    const [active] = await tx
      .select({ id: seedingImports.id })
      .from(seedingImports)
      .where(and(running, gt(seedingImports.startedAt, staleBefore)));
    if (active) throw new SeedingRuleError('import-running');
    await tx
      .update(seedingImports)
      .set({ status: 'failed', finishedAt: now })
      .where(and(running, lte(seedingImports.startedAt, staleBefore)));
    const [row] = await tx
      .insert(seedingImports)
      .values({ destinationId, requestedBy: adminId, startedAt: now })
      .returning();
    if (!row) throw new Error('import not inserted');
    await queue.send(QUEUES.importOpenData, { importId: row.id }, tx, {
      id: uuidFrom(`import-open-data:${row.id}`),
    });
    return row;
  });
}

export interface SeedingSourceDeps {
  fetch: Egress['fetch'];
  userAgent: string;
}

export type SourceImporter = (area: ImportArea, deps: SeedingSourceDeps) => Promise<ParseResult>;

/** Fetch and parse per source; every request goes through the injected egress fetch. */
export const IMPORTERS: Record<SeedingSource, SourceImporter> = {
  osm: async (area, deps) => parseOverpass(await fetchOverpass(area, deps), area),
  bathing_water: async (area, deps) => parseBathingWater(await fetchBathingWater(area, deps), area),
  overture: async (area, deps) =>
    parseOvertureRows(await readOvertureRows(area, { fetch: deps.fetch }), area),
};

export interface ImportSummary {
  importId: string;
  status: SeedingImportStatus;
  sources: Partial<Record<SeedingSource, SourceRunResult>>;
  /** Rows kept across sources. */
  rows: number;
  /** New candidates created by the grouping. */
  candidates: number;
}

/**
 * Runs one import: each source in turn, each failing on its own, then one grouping pass. The run
 * is done if any source succeeded. An import that is missing or no longer running is a no-op.
 */
export async function runImport(
  db: Db,
  importId: string,
  deps: SeedingSourceDeps,
  now: () => Date,
  importers: Record<SeedingSource, SourceImporter> = IMPORTERS,
): Promise<ImportSummary | null> {
  const [run] = await db
    .select({
      id: seedingImports.id,
      status: seedingImports.status,
      destinationId: seedingImports.destinationId,
      centre: destinations.centre,
      radiusM: destinations.radiusM,
    })
    .from(seedingImports)
    .innerJoin(destinations, eq(destinations.id, seedingImports.destinationId))
    .where(eq(seedingImports.id, importId));
  if (run?.status !== 'running') return null;
  const area: ImportArea = {
    centre: { lat: run.centre.y, lng: run.centre.x },
    radiusM: run.radiusM,
  };

  const sources: Partial<Record<SeedingSource, SourceRunResult>> = {};
  let rows = 0;
  for (const source of SEEDING_SOURCES) {
    try {
      const parsed = await importers[source](area, deps);
      await upsertSourceRows(db, run.destinationId, parsed.rows, now());
      sources[source] = {
        outcome: 'ok',
        fetched: parsed.rows.length + parsed.skipped,
        kept: parsed.rows.length,
        skipped: parsed.skipped,
      };
      rows += parsed.rows.length;
    } catch (error) {
      if (error instanceof SourceError) {
        sources[source] = { outcome: 'failed', failure: error.failure };
      } else {
        console.error(
          JSON.stringify({
            job: QUEUES.importOpenData,
            importId,
            source,
            error: error instanceof Error ? error.constructor.name : typeof error,
          }),
        );
        sources[source] = { outcome: 'failed', failure: 'unavailable' };
      }
    }
  }
  const grouped = await groupUnassigned(db, run.destinationId, now());
  const status: SeedingImportStatus = Object.values(sources).some((s) => s.outcome === 'ok')
    ? 'done'
    : 'failed';
  await db
    .update(seedingImports)
    .set({ status, sources, finishedAt: now() })
    .where(and(eq(seedingImports.id, importId), eq(seedingImports.status, 'running')));
  return { importId, status, sources, rows, candidates: grouped.created };
}
