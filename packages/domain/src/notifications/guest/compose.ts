import { DateTime } from 'luxon';
import { ferryLineLabel, lineOperator, type SafetyAlertFacts } from '../../alerts/vocabulary';
import { CALENDAR_SOURCE_LABELS, type CalendarSource } from '../../calendar/vocabulary';
import type { GuestLanguage } from '../../property/vocabulary';
import type { CivilDate } from '../../time';
import type { DailyTipFacts } from '../../tips/vocabulary';
import { DHMZ_URL } from '../../weather/vocabulary';
import { GUEST_COPY } from './copy';
import { type GuestNotificationKind, NOTICE_PATHS, REVIEW_LINKS } from './vocabulary';

// Guest email and push text, pure: the loader gathers the facts. Neither ever carries contact
// data, the PIN, door codes or the Wi-Fi password; the arrival notice only points to the Guide.
// Safety text quotes its source (DHMZ, Jadrolinija) and never says a sailing is cancelled in
// Fetivi's own words.

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
  /** Safety kinds: the warning or notice, in its source's own words. */
  safety: SafetyAlertFacts | null;
  /** Daily tips: the picked catalog record, as it was at pick time. */
  tip: DailyTipFacts | null;
}

/** The two links of a daily-tip email: the guest page and the RFC 8058 one-click POST target. */
export interface TipsUnsubscribeLinks {
  page: string;
  oneClick: string;
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => values[name] ?? '');
}

function safetyValues(
  safety: SafetyAlertFacts | null,
  language: GuestLanguage,
): Record<string, string> {
  if (!safety) return {};
  const copy = GUEST_COPY[language];
  const at = (iso: string) =>
    DateTime.fromISO(iso, { zone: safety.timezone, locale: language }).toFormat(
      `${copy.dateFormat} HH:mm`,
    );
  if (safety.source === 'DHMZ') {
    const operator = lineOperator(safety.advisory?.lines[0]);
    return {
      level: copy.warningLevels[safety.level],
      area: safety.area,
      event: safety.event,
      description: safety.description,
      time: fill(copy.warningTime, { from: at(safety.onset), to: at(safety.expires) }),
      lines: (safety.advisory?.lines ?? []).map(ferryLineLabel).join(', '),
      operator: operator.name,
      operatorUrl: operator.url ?? '',
      source: safety.source,
      sourceUrl: DHMZ_URL,
    };
  }
  return {
    lines: safety.affected.lines.map(ferryLineLabel).join(', '),
    bulletinTitle: safety.title,
    bulletinUrl: safety.url,
    source: safety.source,
  };
}

function tipValues(tip: DailyTipFacts | null, language: GuestLanguage): Record<string, string> {
  if (!tip) return {};
  const copy = GUEST_COPY[language];
  const km = new Intl.NumberFormat(language, { maximumFractionDigits: 1 });
  return {
    distance:
      tip.distanceKm === null ? '' : fill(copy.tipDistance, { km: km.format(tip.distanceKm) }),
    venue: tip.venueName ? fill(copy.tipVenue, { venueName: tip.venueName }) : '',
  };
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
    ...safetyValues(facts.safety, language),
    ...tipValues(facts.tip, language),
  };
}

/**
 * A daily tip also takes its unsubscribe links: the page link closes the body and the one-click
 * link goes into the `List-Unsubscribe` headers.
 */
export function composeGuestEmail(
  kind: GuestNotificationKind,
  facts: GuestNoticeFacts,
  language: GuestLanguage,
  guestOrigin: string,
  unsubscribe?: TipsUnsubscribeLinks,
): { subject: string; text: string; headers?: Record<string, string> } {
  const copy = GUEST_COPY[language];
  const v = values(facts, language);
  const text = copy.kinds[kind];
  const tipLines = kind === 'daily_tip' && facts.tip ? copy.tipRules[facts.tip.rule] : [];
  const lines = [...text.lines, ...tipLines].map((line) => fill(line, v));
  if (kind === 'checkout_reminder' && facts.checkoutTime) {
    lines.push(fill(copy.checkoutTimeLine, v));
  }
  const { safety } = facts;
  if (kind === 'weather_warning' && safety?.source === 'DHMZ') {
    if (safety.advisory) lines.push('', fill(copy.sailingAdvisory, v));
    lines.push('', fill(copy.sourceLine, v));
  }
  if (kind === 'ferry_disruption' && safety?.source === 'Jadrolinija' && safety.affected.orderId) {
    lines.push('', copy.orderStands);
  }
  lines.push('', `${copy.openApp}: ${guestOrigin}${NOTICE_PATHS[kind]}`);
  if (kind === 'checkout_reminder' && facts.reviewPlatform) {
    lines.push('', fill(copy.reviewLine, v), REVIEW_LINKS[facts.reviewPlatform]);
  }
  if (kind === 'daily_tip' && unsubscribe) {
    lines.push('', copy.tipUnsubscribe, unsubscribe.page);
  }
  lines.push('', copy.signature);
  const message = { subject: fill(text.subject, v), text: lines.join('\n') };
  if (kind !== 'daily_tip' || !unsubscribe) return message;
  return {
    ...message,
    headers: {
      'List-Unsubscribe': `<${unsubscribe.oneClick}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
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
