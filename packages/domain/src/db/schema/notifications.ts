import { sql } from 'drizzle-orm';
import {
  bigint,
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
import { HOST_CHANNELS, HOST_DELIVERY_MODES } from '../../notifications/host/vocabulary';
import { ORDER_NOTIFICATIONS } from '../../orders/vocabulary';
import { accounts } from './accounts';
import { orderProposals, orders } from './orders';
import { spaces } from './spaces';

export const orderNotification = pgEnum('order_notification', ORDER_NOTIFICATIONS);

/**
 * One sent notification per Order, proposal and kind (and flagging OrderEvent, for a payment
 * alert: 0 otherwise); what makes a retried send a no-op.
 */
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
    /** The OrderEvent that flagged an `admin_payment_attention`; 0 for every other kind. */
    eventId: bigint('event_id', { mode: 'number' }).notNull().default(0),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.orderId, t.proposalId, t.kind, t.eventId] })],
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

export const hostDeliveryMode = pgEnum('host_delivery_mode', HOST_DELIVERY_MODES);
export const hostChannel = pgEnum('host_channel', HOST_CHANNELS);

/** A host's notification settings. No row means the defaults (Immediate, 09:00, 14:00, 19:00). */
export const hostNotificationSettings = pgTable('host_notification_settings', {
  hostId: uuid('host_id')
    .primaryKey()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  mode: hostDeliveryMode('mode').notNull(),
  /** 'HH:MM' in the host's property timezone, sorted and distinct; kept in Immediate mode too. */
  digestTimes: text('digest_times').array().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export type HostNotificationSettingsRow = typeof hostNotificationSettings.$inferSelect;

/** One sent host notification per key and channel (mirrors `guest_notification_deliveries`). */
export const hostNotificationDeliveries = pgTable(
  'host_notification_deliveries',
  {
    /** `handoff:<id>:host` or `host:<hostId>:digest:<slot>` (`hostNotificationKey`). */
    key: text('key').notNull(),
    channel: hostChannel('channel').notNull(),
    hostId: uuid('host_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.key, t.channel] }),
    index('host_notification_deliveries_host_idx').on(t.hostId),
  ],
);

/** A host's browser push subscription (Home Screen app); an endpoint belongs to one account. */
export const hostPushSubscriptions = pgTable(
  'host_push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('host_push_subscriptions_account_idx').on(t.accountId)],
);
