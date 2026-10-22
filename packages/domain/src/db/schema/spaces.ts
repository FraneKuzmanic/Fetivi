import { bigint, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { properties } from './properties';
import { stays } from './stays';
import { guestLanguage } from './translations';

/** One device's private world inside a Stay. */
export const spaces = pgTable(
  'spaces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stayId: uuid('stay_id')
      .notNull()
      .references(() => stays.id, { onDelete: 'cascade' }),
    /** Hex SHA-256 of the cookie token; the token itself is never stored. */
    tokenHash: text('token_hash').notNull().unique(),
    language: guestLanguage('language').notNull(),
    /** = stays.active_until, kept in step by the stays store. The PIN and chat stop here. */
    closedAt: timestamp('closed_at', { withTimezone: true }).notNull(),
    /** Given on the first Order's card; the latest wins. Full opt-in and verification are ticket 26. */
    email: text('email'),
    /** The one opt-in covering confirmations, recovery and alerts (PRD §6.1); the first time is kept. */
    emailOptInAt: timestamp('email_opt_in_at', { withTimezone: true }),
    /** Set the first time the push offer was answered; never offered again. */
    pushOfferedAt: timestamp('push_offered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('spaces_stay_idx').on(t.stayId)],
);

export type SpaceRow = typeof spaces.$inferSelect;

/** Failed PIN entries only; rows older than PIN_LIMITS.keepMs are deleted on the next attempt. */
export const pinAttempts = pgTable(
  'pin_attempts',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    deviceId: text('device_id').notNull(),
    ip: text('ip').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('pin_attempts_property_idx').on(t.propertyId, t.createdAt),
    index('pin_attempts_device_idx').on(t.deviceId, t.createdAt),
    index('pin_attempts_ip_idx').on(t.ip, t.createdAt),
  ],
);
