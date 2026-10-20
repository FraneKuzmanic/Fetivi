import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { units } from './properties';
import { guestLanguage } from './translations';

// A Stay links to the CalendarEvents that proposed it through `calendar_events.stay_id`
// (ticket 22); a manually registered Stay has none, so there is no column here.
export const stays = pgTable(
  'stays',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' }),
    /** Civil dates in the property's zone. */
    checkIn: date('check_in', { mode: 'string' }).notNull(),
    checkout: date('checkout', { mode: 'string' }).notNull(),
    partySize: smallint('party_size').notNull(),
    /** Host-only; never in any guest projection. */
    bookerName: text('booker_name'),
    reservationNumber: text('reservation_number'),
    /** Stored as generated so the host can re-read it; brute-force limits (08) are the defence. */
    pin: text('pin').notNull(),
    /** 00:00 property time, unit.arrival_release_days_before days before check-in. Derived. */
    arrivalReleaseAt: timestamp('arrival_release_at', { withTimezone: true }).notNull(),
    /** End of checkout day in property time; the PIN works until this instant. Derived. */
    activeUntil: timestamp('active_until', { withTimezone: true }).notNull(),
    /** Set by calendar sync (22) when the event vanishes. */
    possiblyCancelled: boolean('possibly_cancelled').notNull().default(false),
    /** The host's "PIN sent" tick. */
    pinSentAt: timestamp('pin_sent_at', { withTimezone: true }),
    /** The language the host picked for the hand-over message. */
    handoverLanguage: guestLanguage('handover_language').notNull().default('en'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('stays_unit_active_idx').on(t.unitId, t.activeUntil),
    check('stays_pin_check', sql`${t.pin} ~ '^[0-9]{6}$'`),
    check('stays_dates_check', sql`${t.checkout} > ${t.checkIn}`),
    check('stays_party_check', sql`${t.partySize} between 1 and 50`),
  ],
);

export type StayRow = typeof stays.$inferSelect;
