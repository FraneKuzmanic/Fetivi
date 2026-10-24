import type { Egress } from '@fetivi/egress';
import { and, eq, isNull } from 'drizzle-orm';
import { enqueueCurationItem } from '../../curation/store';
import type { CuratedChanges, CurationPayload } from '../../curation/vocabulary';
import type { Db, Executor } from '../../db/client';
import {
  catalogOpeningHours,
  catalogRecords,
  catalogSeasons,
  placeOpenDataSources,
} from '../../db/schema/catalog';
import { type CurationItemRow, curationItems } from '../../db/schema/curation';
import { draftingRuns, draftingTasks } from '../../db/schema/drafting';
import { candidateView } from '../seeding/dedupe';
import { CATEGORY_PRECEDENCE, type SeedingSource } from '../seeding/vocabulary';
import { commonsFileFromTags, fetchCommonsImage } from './commons';
import { diffRefresh } from './diff';
import { fetchPages } from './fetch-pages';
import type { DraftingModel } from './model';
import type { DraftingPage } from './prompt';
import { finishTask } from './runs';
import { allowlistFor, candidateSourceUrls, recordSourceUrls, type SourceRow } from './sources';
import { validateDraft } from './validate';
import type { DraftingFailure, DraftingTaskStatus } from './vocabulary';

// Drafts one task, from the allowed pages through the model to a validated proposal (ADR 0020).
// The fetches and the model call run outside any transaction (architecture §4.3); only the
// result is written, together with the task's finish, so a duplicate job writes nothing.

export interface DraftingDeps {
  db: Db;
  model: DraftingModel;
  /** An egress fetch whose allowlist is exactly these hosts (the task's own sources). */
  fetchFor: (allowlist: readonly string[]) => Egress['fetch'];
  /** The process egress, which allows commons.wikimedia.org. */
  commonsFetch: Egress['fetch'];
  userAgent: string;
}

/** For the job's log line: ids and counts only. `skipped`: the task was not queued any more. */
export interface DraftingTaskSummary {
  status: Exclude<DraftingTaskStatus, 'queued'> | 'skipped';
  pages: number;
  fields: number;
}

/** Location precedence by licence (ADR 0020): permissive sources before ODbL. */
const LOCATION_SOURCES: readonly SeedingSource[] = ['bathing_water', 'overture', 'osm'];

/** Thrown inside a transaction to roll it back when the task was finished meanwhile. */
class AlreadyFinished extends Error {}

const SKIPPED: DraftingTaskSummary = { status: 'skipped', pages: 0, fields: 0 };

async function loadTask(db: Executor, taskId: string) {
  const [row] = await db
    .select({ task: draftingTasks, run: draftingRuns })
    .from(draftingTasks)
    .innerJoin(draftingRuns, eq(draftingRuns.id, draftingTasks.runId))
    .where(eq(draftingTasks.id, taskId));
  return row?.task.status === 'queued' ? row : null;
}

/** Finishes the task in `tx`, or rolls back everything `write` did when it was finished already. */
async function finishWith(
  db: Db,
  taskId: string,
  status: Exclude<DraftingTaskStatus, 'queued'>,
  failure: DraftingFailure | null,
  now: Date,
  write?: (tx: Executor) => Promise<boolean>,
): Promise<boolean> {
  try {
    await db.transaction(async (tx) => {
      // `write` returns false when its subject is gone; the task then ends as record-gone.
      const written = write ? await write(tx) : true;
      const ok = written
        ? await finishTask(tx, taskId, status, failure, now)
        : await finishTask(tx, taskId, 'failed', 'record-gone', now);
      if (!ok) throw new AlreadyFinished();
    });
    return true;
  } catch (error) {
    if (error instanceof AlreadyFinished) return false;
    throw error;
  }
}

type DraftPayload = Extract<CurationPayload, { kind: 'draft' }>;
type DraftPlace = NonNullable<DraftPayload['place']>;

/** Writes the draft item's payload while it is still an open candidate draft. */
const writeItem =
  (item: CurationItemRow, payload: DraftPayload, now: Date) =>
  async (tx: Executor): Promise<boolean> => {
    const [row] = await tx
      .update(curationItems)
      .set({ payload, updatedAt: now })
      .where(
        and(
          eq(curationItems.id, item.id),
          eq(curationItems.status, 'open'),
          isNull(curationItems.recordId),
        ),
      )
      .returning({ id: curationItems.id });
    return row !== undefined;
  };

async function readPages(deps: DraftingDeps, refs: ReturnType<typeof candidateSourceUrls>) {
  if (refs.length === 0) return { pages: [] as DraftingPage[], failed: 0 };
  return fetchPages(deps.fetchFor(allowlistFor(refs)), deps.userAgent, refs);
}

/**
 * A page said the place closed for good: the description leads with that, naming the page that
 * said so, so the admin sees it before approving. A description of its own keeps its source.
 */
function withClosedNote(changes: CuratedChanges, url: string): CuratedChanges {
  const sources = changes.fieldSources ?? {};
  const note = `Permanently closed according to ${url}.`;
  return {
    ...changes,
    description: changes.description ? `${note}\n\n${changes.description}` : note,
    fieldSources: { ...sources, description: sources.description ?? url },
  };
}

/** Drafts one ticked candidate's draft item from its venue, social and tourist-board pages. */
export async function draftCandidateTask(
  deps: DraftingDeps,
  taskId: string,
  now: Date,
): Promise<DraftingTaskSummary> {
  const { db } = deps;
  const loaded = await loadTask(db, taskId);
  if (!loaded?.task.curationItemId) return SKIPPED;
  const [item] = await db
    .select()
    .from(curationItems)
    .where(eq(curationItems.id, loaded.task.curationItemId));
  const payload = item?.payload as CurationPayload | undefined;
  const gone = async (): Promise<DraftingTaskSummary> => {
    const ok = await finishWith(db, taskId, 'failed', 'record-gone', now);
    return ok ? { status: 'failed', pages: 0, fields: 0 } : SKIPPED;
  };
  if (
    item?.status !== 'open' ||
    item.recordId !== null ||
    payload?.kind !== 'draft' ||
    !payload.candidateId
  ) {
    return gone();
  }
  const rows = await db
    .select()
    .from(placeOpenDataSources)
    .where(eq(placeOpenDataSources.candidateId, payload.candidateId));
  if (rows.length === 0) return gone();
  const sourceRows: SourceRow[] = rows.map((r) => ({
    source: r.source,
    data: r.data,
    sourceUrl: r.sourceUrl,
  }));
  const at = now.toISOString();

  /** Records an outcome without a proposal: the item stays Reject-only. */
  const outcome = async (
    status: 'no_sources' | 'failed',
    failure: DraftingFailure | null,
    pages: string[],
  ): Promise<DraftingTaskSummary> => {
    const next: DraftPayload = { ...payload, drafting: { status, at, pages } };
    const ok = await finishWith(db, taskId, status, failure, now, writeItem(item, next, now));
    return ok ? { status, pages: pages.length, fields: 0 } : SKIPPED;
  };

  const { pages, failed } = await readPages(deps, candidateSourceUrls(sourceRows));
  if (pages.length === 0) return outcome('no_sources', failed > 0 ? 'fetch-failed' : null, []);
  const urls = pages.map((p) => p.url);

  const view = candidateView(
    rows.map((r) => ({
      ...r,
      source: r.source as SeedingSource,
      location: { lat: r.location.y, lng: r.location.x },
    })),
  );
  const result = await deps.model.extract({
    name: view.name,
    category: view.placeCategory,
    pages,
  });
  if (!result.ok) return outcome('failed', result.error, urls);

  const draft = validateDraft(result.output, urls);
  // No page names the venue: there is nothing to make a record of.
  if (draft.changes.title === undefined) return outcome('no_sources', null, urls);
  const changes = draft.closedSourceUrl
    ? withClosedNote(draft.changes, draft.closedSourceUrl)
    : draft.changes;

  const located = LOCATION_SOURCES.flatMap((s) => rows.filter((r) => r.source === s))[0];
  if (!located) return gone();
  const categorised = CATEGORY_PRECEDENCE.flatMap((s) => rows.filter((r) => r.source === s)).find(
    (r) => r.placeCategory === view.placeCategory,
  );
  const osm = rows.find((r) => r.source === 'osm');
  const file = commonsFileFromTags(osm?.data.tags as Record<string, unknown> | undefined);
  const image = file ? await fetchCommonsImage(deps.commonsFetch, deps.userAgent, file) : null;

  const next: DraftPayload = {
    ...payload,
    changes,
    place: {
      placeCategory: view.placeCategory,
      categorySourceUrl: categorised?.sourceUrl ?? null,
      location: { lat: located.location.y, lng: located.location.x },
      locationSource: located.source as DraftPlace['locationSource'],
      locationSourceUrl: located.source === 'overture' ? null : located.sourceUrl,
    },
    images: image ? [image] : [],
    drafting: { status: 'drafted', at, pages: urls },
  };
  const ok = await finishWith(db, taskId, 'drafted', null, now, writeItem(item, next, now));
  return ok ? { status: 'drafted', pages: pages.length, fields: draft.fieldCount } : SKIPPED;
}

/**
 * Re-drafts one verified place from its own pages and queues a refresh diff of the factual
 * fields that changed; an unchanged record queues nothing.
 */
export async function refreshRecordTask(
  deps: DraftingDeps,
  taskId: string,
  now: Date,
): Promise<DraftingTaskSummary> {
  const { db } = deps;
  const loaded = await loadTask(db, taskId);
  if (!loaded?.task.recordId) return SKIPPED;
  const { run } = loaded;
  const recordId = loaded.task.recordId;
  const [record] = await db.select().from(catalogRecords).where(eq(catalogRecords.id, recordId));
  const finished = (status: Exclude<DraftingTaskStatus, 'queued'>, pages = 0, fields = 0) =>
    ({ status, pages, fields }) as DraftingTaskSummary;
  if (!record) {
    const ok = await finishWith(db, taskId, 'failed', 'record-gone', now);
    return ok ? finished('failed') : SKIPPED;
  }
  const rows = await db
    .select({
      source: placeOpenDataSources.source,
      data: placeOpenDataSources.data,
      sourceUrl: placeOpenDataSources.sourceUrl,
    })
    .from(placeOpenDataSources)
    .where(eq(placeOpenDataSources.recordId, recordId));

  const refs = recordSourceUrls(
    { websiteUrl: record.websiteUrl, fieldSources: record.fieldSources },
    rows,
  );
  const { pages, failed } = await readPages(deps, refs);
  if (pages.length === 0) {
    const ok = await finishWith(db, taskId, 'no_sources', failed > 0 ? 'fetch-failed' : null, now);
    return ok ? finished('no_sources') : SKIPPED;
  }
  const result = await deps.model.extract({
    name: record.title,
    category: record.placeCategory ?? '',
    pages,
  });
  if (!result.ok) {
    const ok = await finishWith(db, taskId, 'failed', result.error, now);
    return ok ? finished('failed', pages.length) : SKIPPED;
  }
  const draft = validateDraft(
    result.output,
    pages.map((p) => p.url),
  );

  const hours = await db
    .select()
    .from(catalogOpeningHours)
    .where(eq(catalogOpeningHours.recordId, recordId));
  const seasons = await db
    .select()
    .from(catalogSeasons)
    .where(eq(catalogSeasons.recordId, recordId));
  const diff = diffRefresh(
    {
      title: record.title,
      address: record.address,
      phone: record.phone,
      websiteUrl: record.websiteUrl,
      // The database returns times as HH:MM:SS.
      openingHours: hours.map((h) => ({
        weekday: h.weekday,
        opens: h.opens.slice(0, 5),
        closes: h.closes.slice(0, 5),
        validFrom: h.validFrom,
        validTo: h.validTo,
      })),
      seasons: seasons.map((s) => ({
        fromMonth: s.fromMonth,
        fromDay: s.fromDay,
        toMonth: s.toMonth,
        toDay: s.toDay,
      })),
    },
    draft.changes,
  );
  if (!diff) {
    const ok = await finishWith(db, taskId, 'unchanged', null, now);
    return ok ? finished('unchanged', pages.length, draft.fieldCount) : SKIPPED;
  }
  const ok = await finishWith(db, taskId, 'diffed', null, now, async (tx) => {
    // Keyed per run: dedupe keys are global, and next season's diff needs a key of its own.
    await enqueueCurationItem(
      tx,
      {
        destinationId: record.destinationId,
        recordId,
        dedupeKey: `refresh:${recordId}:${run.id}`,
        payload: {
          kind: 'refresh_diff',
          changes: diff.changes,
          previous: diff.previous,
          runId: run.id,
        },
      },
      now,
    );
    return true;
  });
  return ok
    ? finished('diffed', pages.length, Object.keys(diff.changes.fieldSources ?? {}).length)
    : SKIPPED;
}
