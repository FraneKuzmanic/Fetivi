// Guest notification vocabulary. Imports only types: `@fetivi/ui/payloads` and guest-web bundle
// this file through the `@fetivi/domain/notification-vocabulary` subpath, and the pgEnums are built
// from it.

import type { CalendarSource } from '../../calendar/vocabulary';

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
  /** Safety, always sent to every open space in the Stay: an official DHMZ weather warning. */
  'weather_warning',
  /** Safety, always sent to every open space in the Stay: a ferry notice touching a plan item or Order. */
  'ferry_disruption',
  /**
   * At most one a day per Space: a rule-picked catalog tip about tomorrow. Inbox; email only with
   * the daily-tip opt-in; never push.
   */
  'daily_tip',
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
  weather_warning: GUEST_CHANNELS,
  ferry_disruption: GUEST_CHANNELS,
  daily_tip: ['inbox', 'email'],
};

/** Property-local time of the evening-before reminders (Order item, checkout). */
export const EVENING_REMINDER_TIME = '18:00';

/** The guest-reminders cron (UTC); arrival and checkout notices are picked up within 15 minutes. */
export const GUEST_REMINDERS_CRON = '*/15 * * * *';

/** The guest-app path a notice opens: My trip for Orders, the Guide for the Stay, else the Chat. */
export const NOTICE_PATHS = {
  order_confirmed: '/trip',
  order_new_proposal: '/trip',
  order_cancelled: '/trip',
  order_declined: '/trip',
  order_expired: '/trip',
  order_failed: '/trip',
  order_reminder: '/trip',
  host_reply: '/chat',
  arrival_details: '/guide',
  checkout_reminder: '/guide',
  weather_warning: '/chat',
  ferry_disruption: '/trip',
  daily_tip: '/chat',
} as const satisfies Record<GuestNotificationKind, '/trip' | '/guide' | '/chat'>;

/** Where the checkout review line links, per calendar feed source: the guest's trips page there. */
export const REVIEW_LINKS: Record<CalendarSource, string> = {
  airbnb: 'https://www.airbnb.com/trips',
  booking: 'https://secure.booking.com/myreservations.html',
};

/** Push services the jobs process may send to: FCM (Chrome, Samsung, Edge) and Mozilla (Firefox). */
export const PUSH_HOSTS = ['fcm.googleapis.com', '*.push.services.mozilla.com'] as const;
