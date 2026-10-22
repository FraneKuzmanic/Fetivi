import { DateTime } from 'luxon';
import { CALENDAR_SOURCE_LABELS, type CalendarSource } from '../../calendar/vocabulary';
import type { GuestLanguage } from '../../property/vocabulary';
import type { CivilDate } from '../../time';
import { GUEST_COPY } from './copy';
import { type GuestNotificationKind, NOTICE_PATHS, REVIEW_LINKS } from './vocabulary';

// Guest email and push text, pure: the loader gathers the facts. Neither ever carries contact
// data, the PIN, door codes or the Wi-Fi password; the arrival notice only points to the Guide.

/** What a notice says, beyond its kind. Null where the kind has no such fact. */
export interface GuestNoticeFacts {
  offerTitle: string | null;
  date: CivilDate | null;
  /** 'HH:mm' property time, as the guest's receipts show it. */
  startTime: string | null;
  /** 'HH:mm', the unit's checkout time. */
  checkoutTime: string | null;
  /** The booking platform the Stay came from; null for a Stay registered by hand. */
  reviewPlatform: CalendarSource | null;
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => values[name] ?? '');
}

function values(facts: GuestNoticeFacts, language: GuestLanguage): Record<string, string> {
  const copy = GUEST_COPY[language];
  const day = facts.date
    ? DateTime.fromISO(facts.date, { locale: language }).toFormat(copy.dateFormat)
    : '';
  return {
    offer: facts.offerTitle ?? '',
    date: facts.startTime ? fill(copy.dateAtTime, { date: day, time: facts.startTime }) : day,
    checkoutTime: facts.checkoutTime ?? '',
    platform: facts.reviewPlatform ? CALENDAR_SOURCE_LABELS[facts.reviewPlatform] : '',
  };
}

export function composeGuestEmail(
  kind: GuestNotificationKind,
  facts: GuestNoticeFacts,
  language: GuestLanguage,
  guestOrigin: string,
): { subject: string; text: string } {
  const copy = GUEST_COPY[language];
  const v = values(facts, language);
  const text = copy.kinds[kind];
  const lines = text.lines.map((line) => fill(line, v));
  if (kind === 'checkout_reminder' && facts.checkoutTime) {
    lines.push(fill(copy.checkoutTimeLine, v));
  }
  lines.push('', `${copy.openApp}: ${guestOrigin}${NOTICE_PATHS[kind]}`);
  if (kind === 'checkout_reminder' && facts.reviewPlatform) {
    lines.push('', fill(copy.reviewLine, v), REVIEW_LINKS[facts.reviewPlatform]);
  }
  lines.push('', copy.signature);
  return { subject: fill(text.subject, v), text: lines.join('\n') };
}

/** A short title and body in the space language, and a same-origin path to open. */
export function composeGuestPush(
  kind: GuestNotificationKind,
  facts: GuestNoticeFacts,
  language: GuestLanguage,
): { title: string; body: string; url: string } {
  const text = GUEST_COPY[language].kinds[kind];
  const v = values(facts, language);
  return { title: fill(text.pushTitle, v), body: fill(text.pushBody, v), url: NOTICE_PATHS[kind] };
}
