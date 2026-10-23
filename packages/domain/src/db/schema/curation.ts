import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { CURATION_KINDS, CURATION_STATUSES } from '../../curation/vocabulary';
import { accounts } from './accounts';
import { catalogRecords, destinations } from './catalog';

export const curationKind = pgEnum('curation_kind', CURATION_KINDS);
export const curationStatus = pgEnum('curation_status', CURATION_STATUSES);

/**
 * One admin curation queue (architecture §4.2): 38 added host Provider suggestions, 39 the queue,
 * the review actions and fallback clusters.
 */
export const curationItems = pgTable(
  'curation_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: curationKind('kind').notNull(),
    status: curationStatus('status').notNull().default('open'),
    destinationId: uuid('destination_id').references(() => destinations.id, {
      onDelete: 'set null',
    }),
    hostId: uuid('host_id').references(() => accounts.id, { onDelete: 'set null' }),
    /** The catalog record the item is about; an item about a deleted record is moot. */
    recordId: uuid('record_id').references(() => catalogRecords.id, { onDelete: 'cascade' }),
    /** Typed per kind by the store (`CurationPayload`). */
    payload: jsonb('payload').notNull(),
    /** Set on every status change away from open. */
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewedBy: uuid('reviewed_by').references(() => accounts.id, { onDelete: 'set null' }),
    /** When the proposed changes were written to the record, so they are applied at most once. */
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    /** A producer that sets it gets at most one item per key. */
    dedupeKey: text('dedupe_key').unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('curation_items_status_kind_created_idx').on(t.status, t.kind, t.createdAt),
    index('curation_items_record_idx').on(t.recordId),
  ],
);

export type CurationItemRow = typeof curationItems.$inferSelect;
