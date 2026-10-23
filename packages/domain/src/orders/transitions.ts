import type { AvailabilityMode, PaymentMode } from '../offers/vocabulary';
import type { OrderNotification, OrderStatus, OrderTrigger, PaymentStatus } from './vocabulary';

// The pure transition table of the Order machine. Anything not listed is illegal.
// Final statuses have no outgoing edges, admin included. The response window is not an edge:
// a missed window alerts the admin (PRD §6.4), who records the phoned answer as `admin`.

export const ORDER_ACTIONS = [
  'guest_confirm',
  'confirm',
  'decline',
  'fail',
  'expire',
  'cancel',
  'complete',
  'propose',
] as const;
export type OrderAction = (typeof ORDER_ACTIONS)[number];

type Edge = { triggers: readonly OrderTrigger[]; to: OrderStatus | 'after_guest_confirm' };

const TABLE: Partial<Record<OrderStatus, Partial<Record<OrderAction, Edge>>>> = {
  awaiting_confirmation: {
    guest_confirm: { triggers: ['guest', 'admin'], to: 'after_guest_confirm' },
    expire: { triggers: ['card_timer', 'admin'], to: 'expired' },
    cancel: { triggers: ['guest', 'admin'], to: 'cancelled' },
  },
  confirming: {
    confirm: { triggers: ['adapter', 'admin'], to: 'confirmed' },
    fail: { triggers: ['adapter', 'admin', 'payment_job'], to: 'failed' },
    expire: {
      triggers: ['hold_timer', 'admin', 'payment_webhook', 'payment_job'],
      to: 'expired',
    },
  },
  pending_provider: {
    confirm: { triggers: ['provider_link', 'admin'], to: 'confirmed' },
    decline: { triggers: ['provider_link', 'admin'], to: 'declined' },
    propose: { triggers: ['provider_link', 'admin'], to: 'awaiting_confirmation' },
    cancel: { triggers: ['guest', 'admin'], to: 'cancelled' },
  },
  confirmed: {
    cancel: { triggers: ['guest', 'provider_link', 'admin'], to: 'cancelled' },
    complete: { triggers: ['completion_timer', 'admin'], to: 'completed' },
  },
};

/** Where the guest's confirmation leads: an engine or allotment hold, or the Provider's answer. */
function afterGuestConfirm(mode: AvailabilityMode): OrderStatus {
  return mode === 'on_request' ? 'pending_provider' : 'confirming';
}

function target(edge: Edge, mode: AvailabilityMode): OrderStatus {
  return edge.to === 'after_guest_confirm' ? afterGuestConfirm(mode) : edge.to;
}

/** The status `action` leads to from `from`, or null when the transition is illegal. */
export function nextStatus(
  from: OrderStatus,
  action: OrderAction,
  trigger: OrderTrigger,
  mode: AvailabilityMode,
): OrderStatus | null {
  const edge = TABLE[from]?.[action];
  return edge?.triggers.includes(trigger) ? target(edge, mode) : null;
}

/**
 * The status `action` by `trigger` ends in from wherever it is legal, or null when no status
 * allows it. Every edge of one action has the same target, so a repeat reads as `unchanged`.
 */
export function actionTarget(
  action: OrderAction,
  trigger: OrderTrigger,
  mode: AvailabilityMode,
): OrderStatus | null {
  for (const edges of Object.values(TABLE)) {
    const edge = edges?.[action];
    if (edge?.triggers.includes(trigger)) return target(edge, mode);
  }
  return null;
}

// The pure Payment-status table of pay-online Orders (33), independent of the Order status.
// Anything not listed is illegal; `none`, `voided`, `refunded` and `failed` lead nowhere else.

export const PAYMENT_ACTIONS = [
  'authorize',
  'capture',
  'void',
  'refund',
  'refunded',
  'refund_failed',
] as const;
export type PaymentAction = (typeof PAYMENT_ACTIONS)[number];

type PaymentEdge = { triggers: readonly OrderTrigger[]; to: PaymentStatus };

const PAYMENT_TABLE: Partial<Record<PaymentStatus, Partial<Record<PaymentAction, PaymentEdge>>>> = {
  none: {
    authorize: { triggers: ['payment_webhook', 'payment_job', 'admin'], to: 'authorized' },
  },
  authorized: {
    capture: { triggers: ['payment_job', 'payment_webhook'], to: 'captured' },
    void: { triggers: ['payment_job', 'payment_webhook'], to: 'voided' },
  },
  // A refund is requested by whatever released a captured Order (a cancel by the guest, the
  // Provider or the admin), or by a capture that lost a race against a release.
  captured: {
    refund: {
      triggers: ['payment_job', 'payment_webhook', 'admin', 'provider_link', 'guest'],
      to: 'refund_pending',
    },
  },
  refund_pending: {
    refunded: { triggers: ['payment_job', 'payment_webhook'], to: 'refunded' },
    refund_failed: { triggers: ['payment_job', 'payment_webhook'], to: 'failed' },
  },
};

/** The Payment status `action` leads to from `from`, or null when the transition is illegal. */
export function nextPaymentStatus(
  from: PaymentStatus,
  action: PaymentAction,
  trigger: OrderTrigger,
): PaymentStatus | null {
  const edge = PAYMENT_TABLE[from]?.[action];
  return edge?.triggers.includes(trigger) ? edge.to : null;
}

/**
 * The Payment status `action` by `trigger` ends in from wherever it is legal, or null when no
 * status allows it, so a repeat reads as `unchanged`.
 */
export function paymentActionTarget(
  action: PaymentAction,
  trigger: OrderTrigger,
): PaymentStatus | null {
  for (const edges of Object.values(PAYMENT_TABLE)) {
    const edge = edges?.[action];
    if (edge?.triggers.includes(trigger)) return edge.to;
  }
  return null;
}

/**
 * The notifications a status change requires, in the order they are enqueued. Creation into
 * `awaiting_confirmation` notifies nobody; a later proposal leading there tells the guest. A
 * pay-online Order expiring from `confirming` was never paid in time, which the guest hears as
 * such. `admin_payment_attention` is not here: the payment transitions that flag enqueue it.
 */
export function requiredNotifications(
  from: OrderStatus | null,
  to: OrderStatus,
  trigger: OrderTrigger,
  paymentMode: PaymentMode = 'direct',
): OrderNotification[] {
  switch (to) {
    case 'awaiting_confirmation':
      return from === null ? [] : ['order_new_proposal'];
    case 'pending_provider':
      return ['provider_request'];
    case 'confirmed':
      return from === 'confirming'
        ? ['order_confirmed', 'provider_confirmed']
        : ['order_confirmed'];
    case 'declined':
      return ['order_declined'];
    case 'expired':
      return paymentMode === 'online' && from === 'confirming'
        ? ['order_checkout_expired']
        : ['order_expired'];
    case 'failed':
      return ['order_failed'];
    case 'cancelled':
      return trigger === 'provider_link'
        ? ['order_cancelled', 'admin_provider_cancelled']
        : ['order_cancelled'];
    case 'confirming':
    case 'completed':
      return [];
  }
}
