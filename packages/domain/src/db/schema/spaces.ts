import { bigint, index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { SPACE_TOKEN_PURPOSES } from '../../spaces/vocabulary';
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
    /** The one opt-in address (first Order card or the update offer), stored trimmed and lower-case; the latest wins. */
    email: text('email'),
    /** The one opt-in covering confirmations, recovery and alerts (PRD §6.1); the first time is kept. */
    emailOptInAt: timestamp('email_opt_in_at', { withTimezone: true }),
    /**
     * Set when the guest opened a verification or recovery link sent to the current email; cleared
     * when the email changes. Updates are emailed only when set.
     */
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    /** The separate, unticked daily-tip email opt-in (ticket 30 sends); null = no tips by email. */
    tipsEmailOptInAt: timestamp('tips_email_opt_in_at', { withTimezone: true }),
    /** Set the first time the push offer was answered; never offered again. */
    pushOfferedAt: timestamp('push_offered_at', { withTimezone: true }),
    /**
     * Set while the guest keeps the toggle on: the conversation is copied to kept_conversations
     * before deletion. Off (null) by default.
     */
    evaluationOptInAt: timestamp('evaluation_opt_in_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('spaces_stay_idx').on(t.stayId)],
);

export type SpaceRow = typeof spaces.$inferSelect;

export const spaceTokenPurpose = pgEnum('space_token_purpose', SPACE_TOKEN_PURPOSES);

/** Single-use emailed links for a Space; they go with the Space. */
export const spaceTokens = pgTable(
  'space_tokens',
  {
    /** Hex SHA-256 of the token sent by mail; the token itself is never stored. */
    tokenHash: text('token_hash').primaryKey(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    purpose: spaceTokenPurpose('purpose').notNull(),
    /** The address the mail went to. */
    email: text('email').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('space_tokens_space_purpose_idx').on(t.spaceId, t.purpose, t.createdAt)],
);

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
