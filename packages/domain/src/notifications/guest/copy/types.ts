import type { GuestNotificationKind } from '../vocabulary';

/** One notification's email and push text. Placeholders are `{{name}}`. */
export interface KindCopy {
  subject: string;
  /** The email body lines before the app link. */
  lines: string[];
  pushTitle: string;
  pushBody: string;
}

/**
 * Every string of the guest notifications in one language. A missing key is a type error, and
 * the parity test checks that placeholders match English.
 */
export interface GuestCopy {
  /** Luxon format for an Order item's date. */
  dateFormat: string;
  /** An Order item's date with its start time. */
  dateAtTime: string;
  kinds: Record<GuestNotificationKind, KindCopy>;
  /** Added to the checkout reminder when the unit has a checkout time. */
  checkoutTimeLine: string;
  /** Added to the checkout email when the Stay came from a booking platform; neutral, no rating. */
  reviewLine: string;
  /** Precedes the app link at the end of every email. */
  openApp: string;
  signature: string;
}
