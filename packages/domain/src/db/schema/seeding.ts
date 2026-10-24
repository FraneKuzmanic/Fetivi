import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  SEEDING_CANDIDATE_STATUSES,
  SEEDING_IMPORT_STATUSES,
  type SeedingSource,
  type SourceRunResult,
} from '../../catalog/seeding/vocabulary';
import { accounts } from './accounts';
import { destinations } from './catalog';

export const seedingCandidateStatus = pgEnum(
  'seeding_candidate_status',
  SEEDING_CANDIDATE_STATUSES,
);
export const seedingImportStatus = pgEnum('seeding_import_status', SEEDING_IMPORT_STATUSES);

/**
 * A place found in open data for one destination, grouping the source rows that describe it.
 * State only: its name, location and category are derived from its place_open_data_sources rows,
 * so no open-data value is copied out of that table (ADR 0019).
 */
export const seedingCandidates = pgTable(
  'seeding_candidates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    destinationId: uuid('destination_id')
      .notNull()
      .references(() => destinations.id, { onDelete: 'cascade' }),
    status: seedingCandidateStatus('status').notNull().default('new'),
    tickedAt: timestamp('ticked_at', { withTimezone: true }),
    tickedBy: uuid('ticked_by').references(() => accounts.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('seeding_candidates_destination_status_idx').on(t.destinationId, t.status)],
);

/** One open-data import run for a destination, with each source's outcome. */
export const seedingImports = pgTable(
  'seeding_imports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    destinationId: uuid('destination_id')
      .notNull()
      .references(() => destinations.id, { onDelete: 'cascade' }),
    status: seedingImportStatus('status').notNull().default('running'),
    requestedBy: uuid('requested_by').references(() => accounts.id, { onDelete: 'set null' }),
    sources: jsonb('sources')
      .$type<Partial<Record<SeedingSource, SourceRunResult>>>()
      .notNull()
      .default({}),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('seeding_imports_destination_started_idx').on(t.destinationId, t.startedAt)],
);

/** Pairs of candidates the admin said are different places; the store orders the pair (a < b). */
export const seedingKeptApart = pgTable(
  'seeding_kept_apart',
  {
    candidateA: uuid('candidate_a')
      .notNull()
      .references(() => seedingCandidates.id, { onDelete: 'cascade' }),
    candidateB: uuid('candidate_b')
      .notNull()
      .references(() => seedingCandidates.id, { onDelete: 'cascade' }),
    decidedBy: uuid('decided_by').references(() => accounts.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.candidateA, t.candidateB] }),
    check('seeding_kept_apart_order_check', sql`${t.candidateA} < ${t.candidateB}`),
  ],
);

export type SeedingCandidateRow = typeof seedingCandidates.$inferSelect;
export type SeedingImportRow = typeof seedingImports.$inferSelect;
export type SeedingKeptApartRow = typeof seedingKeptApart.$inferSelect;
