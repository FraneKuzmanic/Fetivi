import type { SpaceTokenPurpose } from '../../../spaces/vocabulary';
import type { TipRule } from '../../../tips/vocabulary';
import type { WarningLevel } from '../../../weather/vocabulary';
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
  /** A DHMZ warning level, as it reads inside the weather warning's sentences. */
  warningLevels: Record<WarningLevel, string>;
  /** A warning's span, `{{from}}` and `{{to}}` formatted in the property's zone. */
  warningTime: string;
  /** Added to a wind warning when a plan item or Order depends on a line that day. */
  sailingAdvisory: string;
  /** Added to a ferry notice that touches a booked Order: the Provider's word stands. */
  orderStands: string;
  /** Added to a weather warning: the source and its site. */
  sourceLine: string;
  /** Added to the checkout reminder when the unit has a checkout time. */
  checkoutTimeLine: string;
  /** Added to the checkout email when the Stay came from a booking platform; neutral, no rating. */
  reviewLine: string;
  /** A daily tip's email lines per rule; `{{distance}}` and `{{venue}}` are the fragments below. */
  tipRules: Record<TipRule, string[]>;
  /** Filled into `{{distance}}` when the tip has a distance, else left out. Starts with a space. */
  tipDistance: string;
  /** Filled into `{{venue}}` when an event tip has a venue, else left out. */
  tipVenue: string;
  /** Precedes the one-click unsubscribe link at the end of a daily-tip email. */
  tipUnsubscribe: string;
  /** The verification and recovery mails: body lines, then the action label before the link. */
  spaceEmails: Record<SpaceTokenPurpose, { subject: string; lines: string[]; action: string }>;
  /** Precedes the app link at the end of every email. */
  openApp: string;
  signature: string;
}
