import {
  date,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { MessagePart } from './conversations';
import { paymentMode } from './offers';
import { orderStatus, paymentStatus } from './orders';
import { guestLanguage } from './translations';

/**
 * What survives the 30-day deletion for the 11-year commission accounting rule (architecture
 * §4.2). No foreign keys: it outlives the Space, the Stay and the Offer.
 */
export const orderLedger = pgTable(
  'order_ledger',
  {
    /** Opaque, no FK: the Order is deleted with its Space. */
    orderId: uuid('order_id').primaryKey(),
    /** Opaque, no FK. */
    offerId: uuid('offer_id').notNull(),
    /** The Offer's source title when the row was written. */
    offerTitle: text('offer_title').notNull(),
    /** Null for a host's own Offer. */
    providerId: uuid('provider_id'),
    providerName: text('provider_name'),
    /** Set for a host's own Offer. */
    hostId: uuid('host_id'),
    date: date('date', { mode: 'string' }).notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    quantity: smallint('quantity').notNull(),
    /** The current proposal's total in cents; null if no price was ever named. */
    priceMinor: integer('price_minor'),
    currency: text('currency').notNull(),
    paymentMode: paymentMode('payment_mode').notNull(),
    commissionBp: integer('commission_bp').notNull(),
    status: orderStatus('status').notNull(),
    paymentStatus: paymentStatus('payment_status').notNull(),
    guestEmail: text('guest_email').notNull(),
    orderCreatedAt: timestamp('order_created_at', { withTimezone: true }).notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    /** The Space's closed_at plus 11 years; the daily job deletes the row then. */
    keepUntil: timestamp('keep_until', { withTimezone: true }).notNull(),
  },
  (t) => [index('order_ledger_keep_until_idx').on(t.keepUntil)],
);

export type OrderLedgerRow = typeof orderLedger.$inferSelect;

export interface KeptMessage {
  role: 'user' | 'assistant';
  parts: MessagePart[];
  /** ISO instant. */
  createdAt: string;
}

/**
 * Conversations the guest opted to keep for the thesis evaluation (PRD §6.5): the guest's and
 * Fetivi's chat text only — no system notes, inbox items, tool or card parts, email or preferences.
 */
export const keptConversations = pgTable('kept_conversations', {
  /** Opaque: matches turn_metrics and answer_feedback. */
  conversationId: uuid('conversation_id').primaryKey(),
  language: guestLanguage('language').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  messages: jsonb('messages').$type<KeptMessage[]>().notNull(),
  keptAt: timestamp('kept_at', { withTimezone: true }).notNull(),
});

export type KeptConversationRow = typeof keptConversations.$inferSelect;
