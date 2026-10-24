import { and, asc, count, desc, eq, inArray, isNull, lt, type SQL, sql } from 'drizzle-orm';
import { REVIEWABLE_STATUSES } from '../../curation/vocabulary';
import type { Db, Executor } from '../../db/client';
import { catalogRecords, destinations } from '../../db/schema/catalog';
import { curationItems } from '../../db/schema/curation';
import { draftingRuns, draftingTasks } from '../../db/schema/drafting';
import { type JobQueue, QUEUES, uuidFrom } from '../../jobs/queue';
import { DraftingRuleError } from './errors';
import {
  DRAFTING_LIMITS,
  DRAFTING_TASK_STATUSES,
  type DraftingFailure,
  type DraftingRunKind,
  type DraftingTaskStatus,
} from './vocabulary';

// Drafting's database side (ADR 0020): one admin action starts a run of at most
// `recordsPerRun` tasks, each with its job; the rest wait for the next run the admin starts.

export interface DraftingRunStart {
  runId: string | null;
  queued: number;
  /** Left over the cap; the next run takes them. */
  waiting: number;
}

export interface RunSummary {
  id: string;
  startedAt: Date;
  cap: number;
  waiting: number;
  counts: Record<DraftingTaskStatus, number>;
}

export interface DraftingStatus {
  /** Candidate drafts not drafted yet (or failed) with no queued task. */
  waiting: number;
  draft: RunSummary | null;
  refresh: RunSummary | null;
  /** Verified places a refresh would take now. */
  refreshDue: number;
}

const staleBefore = (now: Date) =>
  new Date(now.getTime() - DRAFTING_LIMITS.taskStaleMinutes * 60_000);

const runsOf = (destinationId: string) =>
  sql`select ${draftingRuns.id} from ${draftingRuns} where ${draftingRuns.destinationId} = ${destinationId}`;

/** Fails the destination's tasks whose job was lost, so they stop blocking a new run. */
async function failStaleTasks(tx: Executor, destinationId: string, now: Date): Promise<void> {
  await tx
    .update(draftingTasks)
    .set({ status: 'failed', finishedAt: now })
    .where(
      and(
        eq(draftingTasks.status, 'queued'),
        lt(draftingTasks.createdAt, staleBefore(now)),
        sql`${draftingTasks.runId} in (${runsOf(destinationId)})`,
      ),
    );
}

async function requireDestination(db: Executor, destinationId: string): Promise<void> {
  const [row] = await db
    .select({ id: destinations.id })
    .from(destinations)
    .where(eq(destinations.id, destinationId));
  if (!row) throw new DraftingRuleError('not-found');
}

/** Open candidate drafts (ADR 0019) that are not drafted yet, or failed, and not queued. */
const waitingDrafts = (destinationId: string): SQL | undefined =>
  and(
    eq(curationItems.destinationId, destinationId),
    eq(curationItems.kind, 'draft'),
    eq(curationItems.status, 'open'),
    isNull(curationItems.recordId),
    sql`${curationItems.payload}->>'candidateId' is not null`,
    sql`coalesce(${curationItems.payload}->'drafting'->>'status', 'failed') = 'failed'`,
    sql`not exists (select 1 from ${draftingTasks} where ${draftingTasks.curationItemId} = ${curationItems.id} and ${draftingTasks.status} = 'queued')`,
  );

/**
 * Verified places with no open refresh diff, no queued refresh task and no refresh finished
 * within the cooldown. A failed refresh does not count, so the next run retries it.
 */
const refreshable = (destinationId: string, now: Date): SQL | undefined => {
  const cooldown = new Date(now.getTime() - DRAFTING_LIMITS.refreshCooldownDays * 86_400_000);
  return and(
    eq(catalogRecords.destinationId, destinationId),
    eq(catalogRecords.kind, 'place'),
    sql`${catalogRecords.verifiedAt} is not null`,
    sql`not exists (select 1 from ${curationItems} where ${curationItems.recordId} = ${catalogRecords.id} and ${curationItems.kind} = 'refresh_diff' and ${inArray(curationItems.status, [...REVIEWABLE_STATUSES])})`,
    sql`not exists (select 1 from ${draftingTasks} where ${draftingTasks.recordId} = ${catalogRecords.id} and (${draftingTasks.status} = 'queued' or (${draftingTasks.status} <> 'failed' and ${draftingTasks.finishedAt} > ${cooldown.toISOString()}::timestamptz)))`,
  );
};

/** Inserts the run and up to `cap` tasks with their jobs; a subject already queued is skipped. */
async function insertRun(
  tx: Executor,
  queue: JobQueue,
  kind: DraftingRunKind,
  destinationId: string,
  subjects: readonly string[],
  adminId: string | null,
  now: Date,
): Promise<DraftingRunStart> {
  if (subjects.length === 0) return { runId: null, queued: 0, waiting: 0 };
  const cap = DRAFTING_LIMITS.recordsPerRun;
  const waiting = Math.max(0, subjects.length - cap);
  const [run] = await tx
    .insert(draftingRuns)
    .values({ destinationId, kind, cap, waiting, requestedBy: adminId, startedAt: now })
    .returning({ id: draftingRuns.id });
  if (!run) throw new Error('drafting run not inserted');
  // The partial unique indexes allow one queued task per subject: a concurrent start that took
  // the same subject wins it, and this run skips it.
  const tasks = await tx
    .insert(draftingTasks)
    .values(
      subjects.slice(0, cap).map((id) => ({
        runId: run.id,
        ...(kind === 'draft' ? { curationItemId: id } : { recordId: id }),
        createdAt: now,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: draftingTasks.id });
  const name = kind === 'draft' ? QUEUES.draftPlace : QUEUES.refreshCatalog;
  for (const task of tasks) {
    await queue.send(name, { taskId: task.id }, tx, { id: uuidFrom(`${name}:${task.id}`) });
  }
  return { runId: run.id, queued: tasks.length, waiting };
}

/**
 * Drafts the destination's waiting candidate drafts, oldest first, inside the caller's
 * transaction (the Seeding tick and "Draft waiting" both start one).
 */
export async function startDraftingRun(
  tx: Executor,
  queue: JobQueue,
  destinationId: string,
  adminId: string | null,
  now: Date,
): Promise<DraftingRunStart> {
  await requireDestination(tx, destinationId);
  await failStaleTasks(tx, destinationId, now);
  const items = await tx
    .select({ id: curationItems.id })
    .from(curationItems)
    .where(waitingDrafts(destinationId))
    .orderBy(asc(curationItems.createdAt), asc(curationItems.id));
  return insertRun(
    tx,
    queue,
    'draft',
    destinationId,
    items.map((i) => i.id),
    adminId,
    now,
  );
}

/** Starts a pre-season refresh of the destination's verified places, oldest verified first. */
export async function startRefreshRun(
  db: Db,
  queue: JobQueue,
  destinationId: string,
  adminId: string | null,
  now: Date,
): Promise<DraftingRunStart> {
  return db.transaction(async (tx) => {
    await requireDestination(tx, destinationId);
    await failStaleTasks(tx, destinationId, now);
    const [running] = await tx
      .select({ id: draftingTasks.id })
      .from(draftingTasks)
      .innerJoin(draftingRuns, eq(draftingRuns.id, draftingTasks.runId))
      .where(
        and(
          eq(draftingRuns.destinationId, destinationId),
          eq(draftingRuns.kind, 'refresh'),
          eq(draftingTasks.status, 'queued'),
        ),
      )
      .limit(1);
    if (running) throw new DraftingRuleError('run-running');
    const records = await tx
      .select({ id: catalogRecords.id })
      .from(catalogRecords)
      .where(refreshable(destinationId, now))
      .orderBy(asc(catalogRecords.verifiedAt), asc(catalogRecords.id));
    return insertRun(
      tx,
      queue,
      'refresh',
      destinationId,
      records.map((r) => r.id),
      adminId,
      now,
    );
  });
}

async function latestRun(
  db: Executor,
  destinationId: string,
  kind: DraftingRunKind,
  now: Date,
): Promise<RunSummary | null> {
  const [run] = await db
    .select()
    .from(draftingRuns)
    .where(and(eq(draftingRuns.destinationId, destinationId), eq(draftingRuns.kind, kind)))
    .orderBy(desc(draftingRuns.startedAt), desc(draftingRuns.id))
    .limit(1);
  if (!run) return null;
  // At most `cap` rows. A task whose job was lost counts as failed here too, before a new run
  // sweeps it.
  const tasks = await db
    .select({ status: draftingTasks.status, createdAt: draftingTasks.createdAt })
    .from(draftingTasks)
    .where(eq(draftingTasks.runId, run.id));
  const counts = Object.fromEntries(DRAFTING_TASK_STATUSES.map((s) => [s, 0])) as Record<
    DraftingTaskStatus,
    number
  >;
  const stale = staleBefore(now);
  for (const t of tasks)
    counts[t.status === 'queued' && t.createdAt < stale ? 'failed' : t.status]++;
  return { id: run.id, startedAt: run.startedAt, cap: run.cap, waiting: run.waiting, counts };
}

/** The Seeding and Destination pages' drafting line: what waits, and the last run of each kind. */
export async function draftingStatus(
  db: Executor,
  destinationId: string,
  now: Date,
): Promise<DraftingStatus> {
  await requireDestination(db, destinationId);
  const [waiting] = await db
    .select({ n: count() })
    .from(curationItems)
    .where(waitingDrafts(destinationId));
  const [due] = await db
    .select({ n: count() })
    .from(catalogRecords)
    .where(refreshable(destinationId, now));
  return {
    waiting: waiting?.n ?? 0,
    draft: await latestRun(db, destinationId, 'draft', now),
    refresh: await latestRun(db, destinationId, 'refresh', now),
    refreshDue: due?.n ?? 0,
  };
}

/**
 * Finishes a queued task. False when it was already finished (a retried or duplicate job), so
 * the caller rolls back whatever it wrote with it.
 */
export async function finishTask(
  tx: Executor,
  taskId: string,
  status: Exclude<DraftingTaskStatus, 'queued'>,
  failure: DraftingFailure | null,
  now: Date,
): Promise<boolean> {
  const [row] = await tx
    .update(draftingTasks)
    .set({ status, failure, finishedAt: now })
    .where(and(eq(draftingTasks.id, taskId), eq(draftingTasks.status, 'queued')))
    .returning({ id: draftingTasks.id });
  return row !== undefined;
}
