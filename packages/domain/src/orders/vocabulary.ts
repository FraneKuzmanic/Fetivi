// Every controlled list of Orders. Imports nothing, like the other vocabulary files, so a UI can
// bundle it later and the pgEnums are built from it.

/** The glossary's Order status, in lifecycle order. Independent of Payment status. */
export const ORDER_STATUSES = [
  'awaiting_confirmation',
  'confirming',
  'pending_provider',
  'confirmed',
  'declined',
  'expired',
  'failed',
  'cancelled',
  'completed',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Statuses with no outgoing transition, admin included. */
export const FINAL_ORDER_STATUSES = [
  'declined',
  'expired',
  'failed',
  'cancelled',
  'completed',
] as const satisfies readonly OrderStatus[];

export function isFinalOrderStatus(status: OrderStatus): boolean {
  return (FINAL_ORDER_STATUSES as readonly OrderStatus[]).includes(status);
}

/** The glossary's Payment status. Pay-direct Orders stay `none`. */
export const PAYMENT_STATUSES = [
  'none',
  'authorized',
  'captured',
  'voided',
  'refund_pending',
  'refunded',
  'failed',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * The explicit causes of a transition (architecture §4.3), recorded on every OrderEvent.
 * `payment_webhook` is a verified Stripe event; `payment_job` is the outcome of a Stripe call the
 * order-payment job made (33). `window_timer` is never recorded: a missed response window alerts
 * the admin and changes no status. `reconciliation` is what the reconciliation job (34) found by
 * reading Stripe or a hold past expiry.
 */
export const ORDER_TRIGGERS = [
  'guest',
  'adapter',
  'provider_link',
  'card_timer',
  'hold_timer',
  'window_timer',
  'completion_timer',
  'admin',
  'payment_webhook',
  'payment_job',
  'reconciliation',
] as const;
export type OrderTrigger = (typeof ORDER_TRIGGERS)[number];

/** Who set a proposal's terms: the Offer's listed terms, "Suggest another time", "Accept with price", admin. */
export const PROPOSERS = ['offer', 'provider_time', 'provider_price', 'admin'] as const;
export type Proposer = (typeof PROPOSERS)[number];

export const HOLD_STATES = ['held', 'committed', 'released'] as const;
export type HoldState = (typeof HOLD_STATES)[number];

export const TIMER_OPERATIONS = [
  'card_expiry',
  'hold_expiry',
  'response_window',
  'completion',
] as const;
export type TimerOperation = (typeof TIMER_OPERATIONS)[number];

export const ORDER_NOTIFICATIONS = [
  /** To the Provider, with the per-order link (15). */
  'provider_request',
  /** To the guest (25). */
  'order_confirmed',
  /** To the guest (25). */
  'order_declined',
  /** To the guest (25). */
  'order_expired',
  /** To the guest (25). */
  'order_failed',
  /** To the guest, and to the Provider when it was confirmed (25). */
  'order_cancelled',
  /** To the guest: a new time or price to confirm (25, 36). */
  'order_new_proposal',
  /** To the admin, who phones the Provider (36). */
  'admin_window_missed',
  /** To the Provider, with the per-order link, when an instant Order is confirmed (15). */
  'provider_confirmed',
  /** To the admin: the Provider tapped Can't fulfil (15). */
  'admin_provider_cancelled',
  /** To the guest: the checkout was not completed in time; nothing was charged (33). */
  'order_checkout_expired',
  /**
   * To the admin: a pay-online Order needs a human (capture or refund failed, a non-card method on
   * the session, an authorization cancelled on a confirmed Order). The reason is the note of the
   * OrderEvent that flagged it (33).
   */
  'admin_payment_attention',
] as const;
export type OrderNotification = (typeof ORDER_NOTIFICATIONS)[number];
