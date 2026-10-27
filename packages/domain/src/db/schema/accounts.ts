import { index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { guestLanguage, providerCardStatus } from './enums';

export const accountRole = pgEnum('account_role', ['host', 'admin']);

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Stored trimmed and lower-cased. */
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: accountRole('role').notNull(),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  suspendedAt: timestamp('suspended_at', { withTimezone: true }),
  /** The back-office language this person reads the setup wizard in (ticket 20). */
  uiLanguage: guestLanguage('ui_language').notNull().default('en'),
  /**
   * A host's own Stripe connected account (38), for own services paid online; the host is
   * merchant of record. Mirrors the `providers` columns.
   */
  stripeAccountId: text('stripe_account_id').unique(),
  stripeCardPayments: providerCardStatus('stripe_card_payments'),
  stripeCheckedAt: timestamp('stripe_checked_at', { withTimezone: true }),
  /** The last Disconnect; a new account after it needs a new idempotency key. */
  stripeDisconnectedAt: timestamp('stripe_disconnected_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const accountTokenPurpose = pgEnum('account_token_purpose', [
  'verify_email',
  'reset_password',
]);

export const accountTokens = pgTable(
  'account_tokens',
  {
    /** Hex SHA-256 of the token sent by mail; the token itself is never stored. */
    tokenHash: text('token_hash').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    purpose: accountTokenPurpose('purpose').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('account_tokens_account_purpose_idx').on(t.accountId, t.purpose, t.createdAt)],
);
