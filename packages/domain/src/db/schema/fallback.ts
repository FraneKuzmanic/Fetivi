import {
  bigint,
  index,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { FALLBACK_OUTCOMES } from '../../fallback/vocabulary';
import { destinations } from './catalog';
import { properties } from './properties';

export const fallbackOutcome = pgEnum('fallback_outcome', FALLBACK_OUTCOMES);

/**
 * One row per web_fallback_search call: a curation gap. Topic keywords and a place only, never
 * the guest's wording; no space, stay or unit.
 */
export const fallbackLog = pgTable(
  'fallback_log',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    /** Null outside a destination. */
    destinationId: uuid('destination_id').references(() => destinations.id, {
      onDelete: 'set null',
    }),
    propertyId: uuid('property_id').references(() => properties.id, { onDelete: 'set null' }),
    /** Normalized keywords; null when the query was rejected (rejected text is never stored). */
    topic: text('topic'),
    place: text('place'),
    outcome: fallbackOutcome('outcome').notNull(),
    resultCount: smallint('result_count').notNull().default(0),
    /** From the injected clock. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('fallback_log_destination_created_idx').on(t.destinationId, t.createdAt)],
);

export type FallbackLogRow = typeof fallbackLog.$inferSelect;
