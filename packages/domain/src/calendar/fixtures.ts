// Test-only: fixture iCal feeds and a stub fetch, so sync tests never reach a real platform.
import type { CalendarSource } from './vocabulary';

/** The real Booking.com export (`.scratch/export.ics`): UID, dates and "CLOSED - Not available" only. */
export const BOOKING_SAMPLE = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//admin.booking.com\\\\\\, b.v.//NONSGML v1.0//EN',
  'CALSCALE:GREGORIAN',
  'METHOD:PUBLISH',
  'BEGIN:VEVENT',
  'DTSTAMP:20261014T112110Z',
  'DTSTART;VALUE=DATE:20261014',
  'DTEND;VALUE=DATE:20261019',
  'UID:7bffdc34362daa98026ec0a50183207e@booking.com',
  'SUMMARY:CLOSED - Not available',
  'ORGANIZER:mailto:noreply@booking.com',
  'END:VEVENT',
  'END:VCALENDAR',
  '',
].join('\r\n');

export interface FixtureEvent {
  uid: string;
  checkIn: string;
  checkout: string;
  summary?: string;
}

const compact = (date: string) => date.replaceAll('-', '');

/** An all-day export in the shape the platform writes; the summary defaults to the platform's text. */
export function ics(events: readonly FixtureEvent[], source: CalendarSource = 'airbnb'): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    source === 'airbnb'
      ? 'PRODID:-//Airbnb Inc//Hosting Calendar 1.0//EN'
      : 'PRODID:-//admin.booking.com\\\\\\, b.v.//NONSGML v1.0//EN',
    'CALSCALE:GREGORIAN',
  ];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      'DTSTAMP:20261019T100000Z',
      `DTSTART;VALUE=DATE:${compact(e.checkIn)}`,
      `DTEND;VALUE=DATE:${compact(e.checkout)}`,
      `UID:${e.uid}`,
      `SUMMARY:${e.summary ?? (source === 'airbnb' ? 'Reserved' : 'CLOSED - Not available')}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR', '');
  return lines.join('\r\n');
}

export type StubResponse = string | { status: number } | Error;

/** A fetch that serves `responses` in order (the last one repeats); an Error is thrown. */
export function stubFetch(
  responses: readonly StubResponse[],
): (url: string, init?: RequestInit) => Promise<Response> {
  let i = 0;
  return async () => {
    const next = responses[Math.min(i++, responses.length - 1)];
    if (next === undefined) throw new Error('stubFetch: no responses');
    if (next instanceof Error) throw next;
    if (typeof next === 'string') {
      return new Response(next, { status: 200, headers: { 'content-type': 'text/calendar' } });
    }
    return new Response('error', { status: next.status });
  };
}
