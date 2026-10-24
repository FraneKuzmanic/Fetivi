import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { GAP_TOPICS } from '../../suggestions/host/vocabulary';
import { units } from './properties';
import { stays } from './stays';

export const gapTopic = pgEnum('gap_topic', GAP_TOPICS);

/**
 * Content gaps (ticket 44): one row per Stay and topic Fetivi could not answer. No text column
 * and no conversation link, so it never holds guest wording and outlives the 30-day deletion.
 */
export const contentGaps = pgTable(
  'content_gaps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stayId: uuid('stay_id')
      .notNull()
      .references(() => stays.id, { onDelete: 'cascade' }),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' }),
    topic: gapTopic('topic').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    unique('content_gaps_stay_id_topic_unique').on(t.stayId, t.topic),
    index('content_gaps_unit_topic_idx').on(t.unitId, t.topic, t.createdAt),
  ],
);

/**
 * Suggestion (architecture §4.2): a topic that went unanswered in at least two Stays of a unit.
 * No text: Fetivi's sentence is rendered when the host reads it, in their language. Resolved once
 * the host fills the wizard field; at most one open Suggestion per unit and topic.
 */
export const hostSuggestions = pgTable(
  'host_suggestions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' }),
    topic: gapTopic('topic').notNull(),
    /** Distinct Stays with this gap since the topic's last resolution. */
    stayCount: integer('stay_count').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('host_suggestions_open_idx').on(t.unitId, t.topic).where(sql`resolved_at is null`),
  ],
);

export type ContentGapRow = typeof contentGaps.$inferSelect;
export type HostSuggestionRow = typeof hostSuggestions.$inferSelect;
