import { index, jsonb, pgEnum, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { CURATION_KINDS, CURATION_STATUSES } from '../../curation/vocabulary';
import { accounts } from './accounts';
import { destinations } from './catalog';

export const curationKind = pgEnum('curation_kind', CURATION_KINDS);
export const curationStatus = pgEnum('curation_status', CURATION_STATUSES);

/**
 * One admin curation queue (architecture §4.2); 38 adds host Provider suggestions, 39 the queue
 * and the other kinds.
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
    /** Typed per kind by the store (`CurationPayload`). */
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('curation_items_status_kind_created_idx').on(t.status, t.kind, t.createdAt)],
);

export type CurationItemRow = typeof curationItems.$inferSelect;
