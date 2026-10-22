import { CalendarRuleError } from './errors';
import { CALENDAR_LIMITS, type CalendarSource } from './vocabulary';

const AIRBNB_HOST = /^(www\.)?airbnb\.[a-z]{2,3}(\.[a-z]{2})?$/;
const BOOKING_HOSTS = new Set(['ical.booking.com', 'admin.booking.com']);

/**
 * Validates a pasted iCal export link and detects its platform. Airbnb country domains are
 * rewritten to www.airbnb.com, so the jobs allowlist stays fixed. Throws invalid-calendar-url.
 */
export function parseFeedUrl(raw: string): { url: string; source: CalendarSource } {
  const value = raw.trim();
  if (value.length > CALENDAR_LIMITS.urlLength) throw new CalendarRuleError('invalid-calendar-url');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CalendarRuleError('invalid-calendar-url');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    throw new CalendarRuleError('invalid-calendar-url');
  }
  url.hash = '';
  const host = url.hostname.toLowerCase();
  if (AIRBNB_HOST.test(host) && url.pathname.startsWith('/calendar/ical/')) {
    url.hostname = 'www.airbnb.com';
    return { url: url.toString(), source: 'airbnb' };
  }
  if (BOOKING_HOSTS.has(host)) return { url: url.toString(), source: 'booking' };
  throw new CalendarRuleError('invalid-calendar-url');
}

/** Host and path only: the query string holds the export secret and is never shown. */
export function feedLabel(url: string): string {
  const parsed = new URL(url);
  return `${parsed.host}${parsed.pathname}`;
}
