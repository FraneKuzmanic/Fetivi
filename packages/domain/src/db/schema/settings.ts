import { sql } from 'drizzle-orm';
import { check, integer, pgTable, smallint, timestamp } from 'drizzle-orm/pg-core';

/** One row: the admin's platform-wide settings. No row = the defaults. */
export const platformSettings = pgTable(
  'platform_settings',
  {
    id: smallint('id').primaryKey().default(1),
    /** Guest chat messages per Space per property day; then chat pauses until the next day. */
    dailyMessageCap: integer('daily_message_cap').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    check('platform_settings_single_row', sql`${t.id} = 1`),
    check('platform_settings_cap_check', sql`${t.dailyMessageCap} between 1 and 1000`),
  ],
);
