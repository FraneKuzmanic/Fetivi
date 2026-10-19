import { bigint, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { accounts } from './accounts';

export const sessions = pgTable(
  'sessions',
  {
    /** Hex SHA-256 of the cookie token. */
    id: text('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    actingAsHostId: uuid('acting_as_host_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    /** Idle expiry, moved forward on activity. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    absoluteExpiresAt: timestamp('absolute_expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('sessions_account_idx').on(t.accountId)],
);

/** Failed logins only. */
export const loginAttempts = pgTable(
  'login_attempts',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    email: text('email').notNull(),
    ip: text('ip').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('login_attempts_email_idx').on(t.email, t.createdAt),
    index('login_attempts_ip_idx').on(t.ip, t.createdAt),
  ],
);
