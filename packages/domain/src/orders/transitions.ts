import type { AvailabilityMode } from '../offers/vocabulary';
import type { OrderNotification, OrderStatus, OrderTrigger } from './vocabulary';

// The pure transition table of the pay-direct Order machine. Anything not listed is illegal.
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
    fail: { triggers: ['adapter', 'admin'], to: 'failed' },
    expire: { triggers: ['hold_timer', 'admin'], to: 'expired' },
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

/** The status `action` leads to from `from`, or null when the transition is illegal. */
export function nextStatus(
  from: OrderStatus,
  action: OrderAction,
  trigger: OrderTrigger,
  mode: AvailabilityMode,
): OrderStatus | null {
  const edge = TABLE[from]?.[action];
  if (!edge?.triggers.includes(trigger)) return null;
  return edge.to === 'after_guest_confirm' ? afterGuestConfirm(mode) : edge.to;
}

/** The status an action always ends in, so a repeat of an applied action reads as `unchanged`. */
export function actionTarget(action: OrderAction, mode: AvailabilityMode): OrderStatus {
  switch (action) {
    case 'guest_confirm':
      return afterGuestConfirm(mode);
    case 'confirm':
      return 'confirmed';
    case 'decline':
      return 'declined';
    case 'fail':
      return 'failed';
    case 'expire':
      return 'expired';
    case 'cancel':
      return 'cancelled';
    case 'complete':
      return 'completed';
    case 'propose':
      return 'awaiting_confirmation';
  }
}

/**
 * The notification each status requires on entry. `awaiting_confirmation` is notified only when
 * a proposal leads there (`order_new_proposal`, sent by the machine), not on creation.
 */
export const REQUIRED_NOTIFICATION: Partial<Record<OrderStatus, OrderNotification>> = {
  pending_provider: 'provider_request',
  confirmed: 'order_confirmed',
  declined: 'order_declined',
  expired: 'order_expired',
  failed: 'order_failed',
  cancelled: 'order_cancelled',
};
