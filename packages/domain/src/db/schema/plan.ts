import { sql } from 'drizzle-orm';
import { check, date, index, pgTable, text, time, timestamp, uuid } from 'drizzle-orm/pg-core';
import { catalogRecords } from './catalog';
import { offers } from './offers';
import { spaces } from './spaces';

/**
 * A suggestion on one Stay day of one Space. Booked items are not stored: they are the Space's
 * confirmed Orders, read at plan time. The checks mirror PLAN_LIMITS; the store checks the
 * 'HH:mm' of PLAN_TIME before writing the `time` column.
 */
export const planItems = pgTable(
  'plan_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    date: date('date', { mode: 'string' }).notNull(),
    /** At the property; null = any time. The API speaks 'HH:mm'. */
    startTime: time('start_time'),
    title: text('title').notNull(),
    note: text('note'),
    recordId: uuid('record_id').references(() => catalogRecords.id, { onDelete: 'set null' }),
    offerId: uuid('offer_id').references(() => offers.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('plan_items_space_date_idx').on(t.spaceId, t.date),
    check('plan_items_title_check', sql`char_length(${t.title}) between 1 and 80`),
    check('plan_items_note_check', sql`${t.note} is null or char_length(${t.note}) <= 280`),
  ],
);

export type PlanItemRow = typeof planItems.$inferSelect;
