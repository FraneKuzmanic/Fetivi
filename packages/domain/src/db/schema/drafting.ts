import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  DRAFTING_FAILURES,
  DRAFTING_RUN_KINDS,
  DRAFTING_TASK_STATUSES,
} from '../../catalog/drafting/vocabulary';
import { accounts } from './accounts';
import { catalogRecords, destinations } from './catalog';
import { curationItems } from './curation';

export const draftingRunKind = pgEnum('drafting_run_kind', DRAFTING_RUN_KINDS);
export const draftingTaskStatus = pgEnum('drafting_task_status', DRAFTING_TASK_STATUSES);
export const draftingFailure = pgEnum('drafting_failure', DRAFTING_FAILURES);

/** One admin-started batch of drafting or pre-season refresh, capped at `cap` records (ADR 0020). */
export const draftingRuns = pgTable(
  'drafting_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    destinationId: uuid('destination_id')
      .notNull()
      .references(() => destinations.id, { onDelete: 'cascade' }),
    kind: draftingRunKind('kind').notNull(),
    cap: smallint('cap').notNull(),
    /** How many were left over the cap when the run started. */
    waiting: integer('waiting').notNull().default(0),
    requestedBy: uuid('requested_by').references(() => accounts.id, { onDelete: 'set null' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('drafting_runs_destination_kind_started_idx').on(t.destinationId, t.kind, t.startedAt),
  ],
);

/** One candidate draft item (kind draft) or one record (kind refresh) of a run. */
export const draftingTasks = pgTable(
  'drafting_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => draftingRuns.id, { onDelete: 'cascade' }),
    curationItemId: uuid('curation_item_id').references(() => curationItems.id, {
      onDelete: 'cascade',
    }),
    recordId: uuid('record_id').references(() => catalogRecords.id, { onDelete: 'cascade' }),
    status: draftingTaskStatus('status').notNull().default('queued'),
    /** A code only; never a raw error message, page text or model output. */
    failure: draftingFailure('failure'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    check(
      'drafting_tasks_subject_check',
      sql`(${t.curationItemId} is null) <> (${t.recordId} is null)`,
    ),
    // One queued task per item or record, so two clicks never draft twice.
    uniqueIndex('drafting_tasks_queued_item_key')
      .on(t.curationItemId)
      .where(sql`status = 'queued'`),
    uniqueIndex('drafting_tasks_queued_record_key').on(t.recordId).where(sql`status = 'queued'`),
    index('drafting_tasks_run_status_idx').on(t.runId, t.status),
  ],
);

export type DraftingRunRow = typeof draftingRuns.$inferSelect;
export type DraftingTaskRow = typeof draftingTasks.$inferSelect;
