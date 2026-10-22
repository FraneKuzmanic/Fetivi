import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { GUEST_CHANNELS, GUEST_NOTIFICATION_KINDS } from '../../notifications/guest/vocabulary';
import { ORDER_NOTIFICATIONS } from '../../orders/vocabulary';
import { orderProposals, orders } from './orders';
import { spaces } from './spaces';

export const orderNotification = pgEnum('order_notification', ORDER_NOTIFICATIONS);

/** One sent notification per Order, proposal and kind; what makes a retried send a no-op. */
export const orderNotificationDeliveries = pgTable(
  'order_notification_deliveries',
  {
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => orderProposals.id, { onDelete: 'cascade' }),
    kind: orderNotification('kind').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.orderId, t.proposalId, t.kind] })],
);

export type OrderNotificationDeliveryRow = typeof orderNotificationDeliveries.$inferSelect;

export const guestNotificationKind = pgEnum('guest_notification_kind', GUEST_NOTIFICATION_KINDS);
export const guestChannel = pgEnum('guest_channel', GUEST_CHANNELS);

/**
 * One sent guest notification per key and channel. Each channel commits on its own, so a failed
 * email does not undo the inbox row and the retry resumes at the email.
 */
export const guestNotificationDeliveries = pgTable(
  'guest_notification_deliveries',
  {
    /** The notification's content-derived key (`guestNotificationKey`). */
    key: text('key').notNull(),
    channel: guestChannel('channel').notNull(),
    kind: guestNotificationKind('kind').notNull(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.key, t.channel] }),
    index('guest_notification_deliveries_space_idx').on(t.spaceId),
  ],
);

export type GuestNotificationDeliveryRow = typeof guestNotificationDeliveries.$inferSelect;

/** A browser push subscription (Android only); an endpoint belongs to one space at a time. */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('push_subscriptions_space_idx').on(t.spaceId)],
);

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;

/** Addresses that bounced permanently or complained (Resend webhook); guest sends skip them. */
export const emailSuppressions = pgTable(
  'email_suppressions',
  {
    /** Lowercased. */
    email: text('email').primaryKey(),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [check('email_suppressions_reason_check', sql`${t.reason} in ('bounced', 'complained')`)],
);
