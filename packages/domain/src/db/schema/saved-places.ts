import { pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';
import { catalogRecords } from './catalog';
import { spaces } from './spaces';

/** A place a Space saved from a card; deleted with the Space or the record. */
export const savedPlaces = pgTable(
  'saved_places',
  {
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    recordId: uuid('record_id')
      .notNull()
      .references(() => catalogRecords.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.spaceId, t.recordId] })],
);
