// Guest notification vocabulary. Imports nothing: `@fetivi/ui/payloads` and guest-web bundle this
// file through the `@fetivi/domain/notification-vocabulary` subpath, and the pgEnums are built
// from it.

/**
 * Every notification a guest receives. The Order kinds keep the exact `ORDER_NOTIFICATIONS`
 * names, so the order-notify job passes them through unmapped.
 */
export const GUEST_NOTIFICATION_KINDS = [
  'order_confirmed',
  'order_new_proposal',
  'order_cancelled',
  'order_declined',
  'order_expired',
  'order_failed',
  /** 18:00 property time the evening before a booked item. */
  'order_reminder',
  'host_reply',
  'arrival_details',
  'checkout_reminder',
] as const;
export type GuestNotificationKind = (typeof GUEST_NOTIFICATION_KINDS)[number];

/** The guest kinds the Order machine enqueues on order-notify. */
export const ORDER_GUEST_KINDS = [
  'order_confirmed',
  'order_new_proposal',
  'order_cancelled',
  'order_declined',
  'order_expired',
  'order_failed',
] as const satisfies readonly GuestNotificationKind[];
export type OrderGuestKind = (typeof ORDER_GUEST_KINDS)[number];

export function isOrderGuestKind(kind: string): kind is OrderGuestKind {
  return (ORDER_GUEST_KINDS as readonly string[]).includes(kind);
}

export const GUEST_CHANNELS = ['inbox', 'email', 'push'] as const;
export type GuestChannel = (typeof GUEST_CHANNELS)[number];

/** Channels per kind, in send order. A host reply's inbox row is written by `deliverReply`. */
export const CHANNELS_BY_KIND: Record<GuestNotificationKind, readonly GuestChannel[]> = {
  order_confirmed: GUEST_CHANNELS,
  order_new_proposal: GUEST_CHANNELS,
  order_cancelled: GUEST_CHANNELS,
  order_declined: GUEST_CHANNELS,
  order_expired: GUEST_CHANNELS,
  order_failed: GUEST_CHANNELS,
  order_reminder: GUEST_CHANNELS,
  host_reply: ['email', 'push'],
  arrival_details: GUEST_CHANNELS,
  checkout_reminder: GUEST_CHANNELS,
};

/** Property-local time of the evening-before reminders (Order item, checkout). */
export const EVENING_REMINDER_TIME = '18:00';

/** The guest-reminders cron (UTC); arrival and checkout notices are picked up within 15 minutes. */
export const GUEST_REMINDERS_CRON = '*/15 * * * *';

/** The booking platforms a Stay can come from (calendar feed sources). */
export type ReviewPlatform = 'airbnb' | 'booking';

/** Where the checkout review line links: the guest's own trips page on the platform. */
export const REVIEW_LINKS: Record<ReviewPlatform, string> = {
  airbnb: 'https://www.airbnb.com/trips',
  booking: 'https://secure.booking.com/myreservations.html',
};

/** Push services the jobs process may send to: FCM (Chrome, Samsung, Edge) and Mozilla (Firefox). */
export const PUSH_HOSTS = ['fcm.googleapis.com', '*.push.services.mozilla.com'] as const;
