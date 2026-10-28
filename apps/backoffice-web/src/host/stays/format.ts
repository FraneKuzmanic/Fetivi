import { CALENDAR_SOURCE_LABELS, type CalendarSource } from '@fetivi/domain/calendar-vocabulary';
import { PIN_WARNING_DAYS } from '@fetivi/domain/stay-vocabulary';
import type { PropertySummary, Stay } from '../../api';
import { i18next, localeOf } from '../../i18n';

// Labels for Stays, in the interface language at the time of the call. Dates are civil dates,
// so they are formatted in UTC and never shift a day. Day first in both languages: "21 Oct",
// "21. lis".

const t = i18next.getFixedT(null, 'host', 'stayFormat');
const civil = (date: string) => new Date(`${date}T00:00:00Z`);
const dayMonth = {
  format: (d: Date) =>
    d.toLocaleDateString(localeOf(i18next.language), {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    }),
};
const dayMonthYear = {
  format: (d: Date) =>
    d.toLocaleDateString(localeOf(i18next.language), {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }),
};

/** "21 Oct – 24 Oct 2026", or with both years when the Stay crosses New Year. */
export function dateRange(checkIn: string, checkout: string): string {
  const sameYear = checkIn.slice(0, 4) === checkout.slice(0, 4);
  const from = (sameYear ? dayMonth : dayMonthYear).format(civil(checkIn));
  return `${from} – ${dayMonthYear.format(civil(checkout))}`;
}

export function nights(checkIn: string, checkout: string): number {
  return Math.round((civil(checkout).getTime() - civil(checkIn).getTime()) / 86_400_000);
}

export function nightsLabel(checkIn: string, checkout: string): string {
  const n = nights(checkIn, checkout);
  return t('nights', { count: n });
}

export const phaseLabel = (phase: Stay['phase']): string => t(phase);

/** "Arrival details from 20 Oct, 00:00" for a local 'YYYY-MM-DDTHH:mm'. */
export function releaseText(arrivalReleaseLocal: string): string {
  const [date = '', time = ''] = arrivalReleaseLocal.split('T');
  return t('release', { date: dayMonth.format(civil(date)), time });
}

/** Units that accept Stays: approved property, QR issued. */
export function liveUnits(properties: PropertySummary[]) {
  const several = properties.length > 1;
  return properties
    .filter((p) => p.approved)
    .flatMap((p) =>
      p.units
        .filter((u) => u.hasQr)
        .map((u) => ({ id: u.id, label: several ? `${p.name} · ${u.name}` : u.name })),
    );
}

/** Calendar names as a list in the interface language: "Airbnb and Booking.com". */
export function calendarNames(sources: readonly CalendarSource[]): string {
  return new Intl.ListFormat(localeOf(i18next.language), { type: 'conjunction' }).format(
    sources.map((s) => CALENDAR_SOURCE_LABELS[s]),
  );
}

export function guestsLabel(partySize: number): string {
  return t('guests', { count: partySize });
}

/** "just now", "12 min ago", "3 h ago", "2 days ago". */
/** The Stays page's one warning line: Stays and calendar bookings close to check-in without a PIN. */
export function pinWarningText(stays: number, proposals: number): string | null {
  const parts: string[] = [];
  if (stays > 0) parts.push(t('pinStays', { count: stays, days: PIN_WARNING_DAYS }));
  if (proposals > 0) parts.push(t('pinProposals', { count: proposals, days: PIN_WARNING_DAYS }));
  return parts.length > 0 ? parts.join(' ') : null;
}

export function agoLabel(iso: string, now: Date = new Date()): string {
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return t('justNow');
  if (minutes < 60) return t('minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('hoursAgo', { count: hours });
  return t('daysAgo', { count: Math.floor(hours / 24) });
}
