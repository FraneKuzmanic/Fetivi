import type { AvailabilityMode, PaymentMode } from '../offers/vocabulary';
import type {
  OrderNotification,
  OrderStatus,
  OrderTrigger,
  PaymentStatus,
  Proposer,
} from './vocabulary';

// The pure transition table of the Order machine. Anything not listed is illegal.
// Final statuses have no outgoing edges, admin included. The response window is not an edge:
// a missed window alerts the admin (PRD §6.4), who records the phoned answer as `admin`.
// `ask_provider` is the authorization of a paid-first on-request Order (ADR 0015).

export const ORDER_ACTIONS = [
  'guest_confirm',
  'confirm',
  'decline',
  'fail',
  'expire',
  'cancel',
  'complete',
  'propose',
  'ask_provider',
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
    fail: {
      triggers: ['adapter', 'admin', 'payment_job', 'payment_webhook', 'reconciliation'],
      to: 'failed',
    },
    expire: {
      triggers: ['hold_timer', 'admin', 'payment_webhook', 'payment_job', 'reconciliation'],
      to: 'expired',
    },
    ask_provider: {
      triggers: ['payment_webhook', 'payment_job', 'reconciliation', 'admin'],
      to: 'pending_provider',
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

/**
 * Whether the guest's confirmation of these terms still needs the Provider's yes: on request, on
 * the Offer's own terms, and not paid first (a priced pay-online Order is put to the Provider once
 * authorized).
 */
export function asksProvider(
  mode: AvailabilityMode,
  proposal: { proposer: Proposer; priceMinor: number | null },
  paymentMode: PaymentMode,
): boolean {
  return (
    mode === 'on_request' &&
    proposal.proposer === 'offer' &&
    !(paymentMode === 'online' && proposal.priceMinor !== null)
  );
}

/** Where the guest's confirmation leads: a hold (then commit or checkout), or the Provider's answer. */
function afterGuestConfirm(asks: boolean): OrderStatus {
  return asks ? 'pending_provider' : 'confirming';
}

function target(edge: Edge, asks: boolean): OrderStatus {
  return edge.to === 'after_guest_confirm' ? afterGuestConfirm(asks) : edge.to;
}

/** The status `action` leads to from `from`, or null when the transition is illegal. */
export function nextStatus(
  from: OrderStatus,
  action: OrderAction,
  trigger: OrderTrigger,
  asks: boolean,
): OrderStatus | null {
  const edge = TABLE[from]?.[action];
  return edge?.triggers.includes(trigger) ? target(edge, asks) : null;
}

/**
 * The status `action` by `trigger` ends in from wherever it is legal, or null when no status
 * allows it. Every edge of one action has the same target, so a repeat reads as `unchanged`.
 */
export function actionTarget(
  action: OrderAction,
  trigger: OrderTrigger,
  asks: boolean,
): OrderStatus | null {
  for (const edges of Object.values(TABLE)) {
    const edge = edges?.[action];
    if (edge?.triggers.includes(trigger)) return target(edge, asks);
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
    authorize: {
      triggers: ['payment_webhook', 'payment_job', 'admin', 'reconciliation'],
      to: 'authorized',
    },
  },
  authorized: {
    capture: { triggers: ['payment_job', 'payment_webhook', 'reconciliation'], to: 'captured' },
    void: { triggers: ['payment_job', 'payment_webhook', 'reconciliation'], to: 'voided' },
  },
  // A refund is requested by whatever released a captured Order (a cancel by the guest, the
  // Provider or the admin), or by a capture that lost a race against a release.
  captured: {
    refund: {
      triggers: [
        'payment_job',
        'payment_webhook',
        'admin',
        'provider_link',
        'guest',
        'reconciliation',
      ],
      to: 'refund_pending',
    },
  },
  refund_pending: {
    refunded: { triggers: ['payment_job', 'payment_webhook', 'reconciliation'], to: 'refunded' },
    refund_failed: { triggers: ['payment_job', 'payment_webhook', 'reconciliation'], to: 'failed' },
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
