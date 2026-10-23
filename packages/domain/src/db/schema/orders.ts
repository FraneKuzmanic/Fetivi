import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  HOLD_STATES,
  ORDER_STATUSES,
  ORDER_TRIGGERS,
  PAYMENT_STATUSES,
  PROPOSERS,
} from '../../orders/vocabulary';
import { INTENT_STATUSES, REFUND_STATUSES, SESSION_STATUSES } from '../../payments/vocabulary';
import { accounts } from './accounts';
import { allotmentSlots, availabilityMode, offers, paymentMode, priceUnit } from './offers';
import { spaces } from './spaces';
import { stays } from './stays';

export const orderStatus = pgEnum('order_status', ORDER_STATUSES);
export const paymentStatus = pgEnum('payment_status', PAYMENT_STATUSES);
export const orderTrigger = pgEnum('order_trigger', ORDER_TRIGGERS);
export const proposer = pgEnum('proposer', PROPOSERS);
export const holdState = pgEnum('hold_state', HOLD_STATES);
export const sessionStatus = pgEnum('session_status', SESSION_STATUSES);
export const intentStatus = pgEnum('intent_status', INTENT_STATUSES);
export const refundStatus = pgEnum('refund_status', REFUND_STATUSES);

/**
 * One guest interaction with an Offer. Its id is the order handle. Only `orders/machine.ts` and
 * `orders/payments.ts` write `status` and `payment_status`.
 */
export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    stayId: uuid('stay_id')
      .notNull()
      .references(() => stays.id, { onDelete: 'cascade' }),
    offerId: uuid('offer_id')
      .notNull()
      .references(() => offers.id, { onDelete: 'restrict' }),
    /** Snapshotted from the Offer at create. */
    availabilityMode: availabilityMode('availability_mode').notNull(),
    paymentMode: paymentMode('payment_mode').notNull(),
    status: orderStatus('status').notNull().default('awaiting_confirmation'),
    paymentStatus: paymentStatus('payment_status').notNull().default('none'),
    /** The current proposal's date, a civil date within the Stay. */
    date: date('date', { mode: 'string' }).notNull(),
    /** The current proposal's quantity. */
    quantity: smallint('quantity').notNull(),
    /** Always required; it goes to Fetivi, not the Provider. */
    guestEmail: text('guest_email').notNull(),
    guestName: text('guest_name'),
    guestPhone: text('guest_phone'),
    /** The Provider system's reservation reference, set on confirmation. */
    providerExternalRef: text('provider_external_ref'),
    /** Hex SHA-256 of the per-order Provider link token (issued by ticket 15). */
    providerLinkTokenHash: text('provider_link_token_hash').unique(),
    /** Snapshot of the Offer's policy and financial terms as approved. */
    cancellationPolicy: text('cancellation_policy').notNull(),
    freeCancelHoursBefore: integer('free_cancel_hours_before').notNull(),
    refundPercentAfter: smallint('refund_percent_after').notNull(),
    currency: text('currency').notNull(),
    priceUnit: priceUnit('price_unit').notNull(),
    /** Basis points; 0 for host Offers. */
    commissionBp: integer('commission_bp').notNull(),
    /** Set in the same transaction as the first proposal. */
    currentProposalId: uuid('current_proposal_id').references(
      (): AnyPgColumn => orderProposals.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('orders_space_idx').on(t.spaceId),
    index('orders_stay_idx').on(t.stayId),
    index('orders_offer_idx').on(t.offerId),
    check('orders_quantity_check', sql`${t.quantity} between 1 and 999`),
    check('orders_payment_check', sql`${t.paymentMode} = 'online' or ${t.paymentStatus} = 'none'`),
  ],
);

/** One versioned set of terms. A new proposal supersedes the previous one. */
export const orderProposals = pgTable(
  'order_proposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    /** Null when the Offer has no start time. */
    startsAt: timestamp('starts_at', { withTimezone: true }),
    slotId: uuid('slot_id').references(() => allotmentSlots.id, { onDelete: 'set null' }),
    quantity: smallint('quantity').notNull(),
    /** Total in cents; null only for a request-kind Order before the Provider names a price. */
    priceMinor: integer('price_minor'),
    currency: text('currency').notNull(),
    proposer: proposer('proposer').notNull(),
    /** When the guest's confirmation card stops working; null when confirmed at creation. */
    cardExpiresAt: timestamp('card_expires_at', { withTimezone: true }),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    /** When the Provider tapped Got it for these terms. */
    providerAcknowledgedAt: timestamp('provider_acknowledged_at', { withTimezone: true }),
    /** When the Provider's answer is due; set when the proposal is put to the Provider (36). */
    responseDueAt: timestamp('response_due_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('order_proposals_order_version_unique').on(t.orderId, t.version),
    check('order_proposals_quantity_check', sql`${t.quantity} between 1 and 999`),
  ],
);

/** The append-only audit trail: one row per status change, with its cause. Updates are rejected. */
export const orderEvents = pgTable(
  'order_events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    proposalId: uuid('proposal_id'),
    /** Null on creation. */
    fromStatus: orderStatus('from_status'),
    toStatus: orderStatus('to_status').notNull(),
    fromPaymentStatus: paymentStatus('from_payment_status'),
    toPaymentStatus: paymentStatus('to_payment_status').notNull(),
    trigger: orderTrigger('trigger').notNull(),
    /** The admin who acted, for admin overrides. */
    actorId: uuid('actor_id').references(() => accounts.id, { onDelete: 'set null' }),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('order_events_order_idx').on(t.orderId, t.id)],
);

/** Capacity held for one proposal: an allotment slot decrement or a live engine's hold. */
export const inventoryHolds = pgTable('inventory_holds', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),
  proposalId: uuid('proposal_id')
    .notNull()
    .unique()
    .references(() => orderProposals.id, { onDelete: 'cascade' }),
  slotId: uuid('slot_id').references(() => allotmentSlots.id, { onDelete: 'restrict' }),
  /** The live engine's hold reference (ticket 37). */
  externalRef: text('external_ref'),
  quantity: smallint('quantity').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  state: holdState('state').notNull().default('held'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
});

/**
 * One Stripe Checkout Session and payment intent for one proposal, on the Provider's connected
 * account. Every Stripe parameter is stored here before the first call, so a retry sends identical
 * parameters. Written only by `orders/machine.ts`, `orders/payments.ts` and `payments/jobs.ts`
 * (Stripe ids and mirror).
 */
export const paymentAttempts = pgTable(
  'payment_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => orderProposals.id, { onDelete: 'cascade' }),
    /** The proposal's version: the `<n>` of the idempotency keys. */
    proposalVersion: integer('proposal_version').notNull(),
    /** Snapshot of the Provider's connected account at create. */
    stripeAccountId: text('stripe_account_id').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull(),
    /** Fetivi's commission, set on the capture call. */
    applicationFeeMinor: integer('application_fee_minor').notNull(),
    /** Snapshot of the Offer title, the Checkout line item. */
    productName: text('product_name').notNull(),
    /** Checkout `locale`. */
    locale: text('locale').notNull(),
    /** The Checkout Session's `expires_at`, equal to the inventory hold's; stored before the create call. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** Set when a create was sent at least once: from then on the create is replayed, never restamped. */
    createSentAt: timestamp('create_sent_at', { withTimezone: true }),
    sessionId: text('session_id').unique(),
    checkoutUrl: text('checkout_url'),
    sessionStatus: sessionStatus('session_status'),
    paymentIntentId: text('payment_intent_id').unique(),
    intentStatus: intentStatus('intent_status'),
    refundId: text('refund_id'),
    refundStatus: refundStatus('refund_status'),
    /** What the refund returns, set before the first refund call; null until a refund is decided. */
    refundAmountMinor: integer('refund_amount_minor'),
    /** Stripe event ids already applied; an event is processed once. */
    processedEventIds: text('processed_event_ids').array().notNull().default(sql`'{}'::text[]`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('payment_attempts_proposal_unique').on(t.proposalId),
    index('payment_attempts_order_idx').on(t.orderId),
    check('payment_attempts_amount_check', sql`${t.amountMinor} > 0`),
    check(
      'payment_attempts_fee_check',
      sql`${t.applicationFeeMinor} >= 0 and ${t.applicationFeeMinor} <= ${t.amountMinor}`,
    ),
    check(
      'payment_attempts_refund_amount_check',
      sql`${t.refundAmountMinor} is null or (${t.refundAmountMinor} >= 0 and ${t.refundAmountMinor} <= ${t.amountMinor})`,
    ),
  ],
);

export type OrderRow = typeof orders.$inferSelect;
export type OrderProposalRow = typeof orderProposals.$inferSelect;
export type OrderEventRow = typeof orderEvents.$inferSelect;
export type InventoryHoldRow = typeof inventoryHolds.$inferSelect;
export type PaymentAttemptRow = typeof paymentAttempts.$inferSelect;
