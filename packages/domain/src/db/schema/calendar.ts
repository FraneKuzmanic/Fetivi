import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { CALENDAR_EVENT_STATUSES, CALENDAR_SOURCES } from '../../calendar/vocabulary';
import { units } from './properties';
import { stays } from './stays';

export const calendarSource = pgEnum('calendar_source', CALENDAR_SOURCES);
export const calendarEventStatus = pgEnum('calendar_event_status', CALENDAR_EVENT_STATUSES);

/** A unit's Airbnb or Booking.com iCal export link, read about every 30 minutes. */
export const calendarFeeds = pgTable(
  'calendar_feeds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' }),
    source: calendarSource('source').notNull(),
    /** Normalised. Secret: the query string is the export token; never returned or logged. */
    url: text('url').notNull(),
    /** Last attempt. */
    lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
    /** Last successful parse. */
    lastOkAt: timestamp('last_ok_at', { withTimezone: true }),
    /** 'fetch-failed' | 'http-<status>' | 'too-large' | 'not-a-calendar'; null after a success. */
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('calendar_feeds_unit_url_unique').on(t.unitId, t.url),
    index('calendar_feeds_unit_idx').on(t.unitId),
  ],
);
export type CalendarFeedRow = typeof calendarFeeds.$inferSelect;

/**
 * One event of a feed, by its UID. Pending events are proposals (grouped with other feeds'
 * pending events of identical dates when read); confirmed ones link to their Stay; dismissed
 * ones are kept so the UID is never proposed again.
 */
export const calendarEvents = pgTable(
  'calendar_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    feedId: uuid('feed_id')
      .notNull()
      .references(() => calendarFeeds.id, { onDelete: 'cascade' }),
    uid: text('uid').notNull(),
    /** Civil dates in the property's zone; DTEND is exclusive, so it is the checkout date. */
    checkIn: date('check_in', { mode: 'string' }).notNull(),
    checkout: date('checkout', { mode: 'string' }).notNull(),
    /** SUMMARY only, truncated. Never DESCRIPTION (Airbnb puts phone digits there). */
    summary: text('summary'),
    status: calendarEventStatus('status').notNull().default('pending'),
    /** Null for pending and dismissed events, and for confirmed ones whose Stay was deleted. */
    stayId: uuid('stay_id').references(() => stays.id, { onDelete: 'set null' }),
    /** Set when a confirmed event is missing from the feed. */
    vanishedAt: timestamp('vanished_at', { withTimezone: true }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('calendar_events_feed_uid_unique').on(t.feedId, t.uid),
    index('calendar_events_stay_idx').on(t.stayId),
    check('calendar_events_dates_check', sql`${t.checkout} > ${t.checkIn}`),
    check(
      'calendar_events_dismissed_check',
      sql`(${t.status} = 'dismissed') = (${t.dismissedAt} is not null)`,
    ),
  ],
);
export type CalendarEventRow = typeof calendarEvents.$inferSelect;
