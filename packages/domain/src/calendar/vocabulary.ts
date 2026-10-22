// Calendar sync vocabulary. Imports nothing: the back-office SPA bundles this file through the
// `@fetivi/domain/calendar-vocabulary` subpath.

export const CALENDAR_SOURCES = ['airbnb', 'booking'] as const;
export type CalendarSource = (typeof CALENDAR_SOURCES)[number];

export const CALENDAR_SOURCE_LABELS: Record<CalendarSource, string> = {
  airbnb: 'Airbnb',
  booking: 'Booking.com',
};

export const CALENDAR_EVENT_STATUSES = ['pending', 'confirmed', 'dismissed'] as const;
export type CalendarEventStatus = (typeof CALENDAR_EVENT_STATUSES)[number];

/** Hosts the jobs process may fetch calendars from. Airbnb country domains are rewritten to www.airbnb.com on input. */
export const CALENDAR_HOSTS = ['www.airbnb.com', 'ical.booking.com', 'admin.booking.com'] as const;

export const CALENDAR_LIMITS = {
  feedsPerUnit: 6,
  urlLength: 2048,
  maxBytes: 2_000_000,
  maxEvents: 2000,
  fetchTimeoutMs: 15_000,
  summaryLength: 200,
  uidLength: 512,
} as const;

/** Poll period in minutes; the cron and the fan-out slot key use it. */
export const CALENDAR_POLL_MINUTES = 30;
