import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { FINDING_KINDS, FINDING_STATUSES, RECONCILE_TRIGGERS } from '../../payments/vocabulary';
import { accounts } from './accounts';
import { orders } from './orders';

export const reconcileTrigger = pgEnum('reconcile_trigger', RECONCILE_TRIGGERS);
export const findingKind = pgEnum('reconciliation_finding_kind', FINDING_KINDS);
export const findingStatus = pgEnum('reconciliation_finding_status', FINDING_STATUSES);

/** One run of the reconciliation job (34). A run without `finishedAt` did not finish. */
export const reconciliationRuns = pgTable(
  'reconciliation_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    trigger: reconcileTrigger('trigger').notNull(),
    /** The admin who pressed Run now. */
    requestedBy: uuid('requested_by').references(() => accounts.id, { onDelete: 'set null' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    checked: integer('checked').notNull().default(0),
    found: integer('found').notNull().default(0),
    resolved: integer('resolved').notNull().default(0),
    /** A code only, such as `stripe-unavailable` or `stripe-not-configured`. */
    error: text('error'),
  },
  (t) => [index('reconciliation_runs_started_idx').on(t.startedAt)],
);

/**
 * One disagreement between Fetivi and Stripe or a hold, and what was done about it. An open
 * (`needs_attention`) finding seen again is updated in place, not duplicated.
 */
export const reconciliationFindings = pgTable(
  'reconciliation_findings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The run that last saw it. */
    runId: uuid('run_id')
      .notNull()
      .references(() => reconciliationRuns.id, { onDelete: 'cascade' }),
    kind: findingKind('kind').notNull(),
    /** The stable key: `attempt:<id>`, `hold:<id>` or `session:<account>:<cs id>`. */
    subject: text('subject').notNull(),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
    /** No foreign key: after a restore the attempt may be gone. */
    attemptId: uuid('attempt_id'),
    holdId: uuid('hold_id'),
    /** A `cs_…`, `pi_…` or `re_…` id. */
    stripeRef: text('stripe_ref'),
    /** Ids and statuses only, never contact data. */
    detail: text('detail').notNull(),
    /** What was fed through the machine and its outcome, such as `authorize: applied`. */
    action: text('action'),
    status: findingStatus('status').notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    /** The admin who marked it resolved. */
    resolvedBy: uuid('resolved_by').references(() => accounts.id, { onDelete: 'set null' }),
  },
  (t) => [
    uniqueIndex('reconciliation_findings_open_unique')
      .on(t.kind, t.subject)
      .where(sql`status = 'needs_attention'`),
    index('reconciliation_findings_status_idx').on(t.status, t.lastSeenAt),
  ],
);

export type ReconciliationRunRow = typeof reconciliationRuns.$inferSelect;
export type ReconciliationFindingRow = typeof reconciliationFindings.$inferSelect;
