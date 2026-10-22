import { describe, expect, it } from 'vitest';
import { CalendarFeedError } from './errors';
import { BOOKING_SAMPLE } from './fixtures';
import { parseICal } from './ical';

const ZONE = 'Europe/Zagreb';

const calendar = (...body: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', ...body, 'END:VCALENDAR'].join('\r\n');

const vevent = (...lines: string[]) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'];

const code = (run: () => unknown) => {
  try {
    run();
    return 'ok';
  } catch (error) {
    return error instanceof CalendarFeedError ? error.code : String(error);
  }
};

describe('parseICal', () => {
  it('reads the real Booking.com export', () => {
    expect(parseICal(BOOKING_SAMPLE, ZONE)).toEqual([
      {
        uid: '7bffdc34362daa98026ec0a50183207e@booking.com',
        checkIn: '2026-10-14',
        checkout: '2026-10-19',
        summary: 'CLOSED - Not available',
        cancelled: false,
      },
    ]);
  });

  it('reads Airbnb events and never keeps the description', () => {
    const text = calendar(
      ...vevent(
        'DTSTART;VALUE=DATE:20261024',
        'DTEND;VALUE=DATE:20261027',
        'UID:1418fb94e984-a1b2@airbnb.com',
        'SUMMARY:Reserved',
        'DESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMABC\\nPhone Number (Last 4 Digits): 1234',
      ),
      ...vevent(
        'DTSTART;VALUE=DATE:20261101',
        'DTEND;VALUE=DATE:20261105',
        'UID:7f6c-b2c3@airbnb.com',
        'SUMMARY:Airbnb (Not available)',
      ),
    );
    const events = parseICal(text, ZONE);
    expect(events.map((e) => e.summary)).toEqual(['Reserved', 'Airbnb (Not available)']);
    expect(JSON.stringify(events)).not.toContain('1234');
  });

  it('unfolds lines, unescapes text and accepts LF-only input', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART;VALUE=DATE:20261024',
      'DTEND;VALUE=DATE:20261027',
      'UID:long-',
      ' uid@example',
      'SUMMARY:Ana\\, Ivo\\; and\\nfriends \\\\ ',
      '\tok',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\n');
    expect(parseICal(text, ZONE)).toMatchObject([
      { uid: 'long-uid@example', summary: 'Ana, Ivo; and friends \\ ok' },
    ]);
  });

  it('converts a DATE-TIME to the civil date in the property zone', () => {
    const text = calendar(
      ...vevent('DTSTART:20261023T230000Z', 'DTEND:20261026T233000Z', 'UID:a'),
      ...vevent(
        'DTSTART;TZID=America/New_York:20261023T200000',
        'DTEND;TZID=America/New_York:20261026T090000',
        'UID:b',
      ),
    );
    expect(parseICal(text, ZONE)).toMatchObject([
      { uid: 'a', checkIn: '2026-10-24', checkout: '2026-10-27' },
      { uid: 'b', checkIn: '2026-10-24', checkout: '2026-10-26' },
    ]);
  });

  it('skips events without a UID or valid dates', () => {
    const text = calendar(
      ...vevent('DTSTART;VALUE=DATE:20261024', 'UID:no-end'),
      ...vevent('DTSTART;VALUE=DATE:20261024', 'DTEND;VALUE=DATE:20261024', 'UID:zero'),
      ...vevent('DTSTART;VALUE=DATE:20261024', 'DTEND;VALUE=DATE:20261027'),
      ...vevent('DTSTART;VALUE=DATE:20261024', 'DTEND;VALUE=DATE:20261399', 'UID:bad-date'),
      ...vevent(
        'DTSTART;VALUE=DATE:20261024',
        'DTEND;VALUE=DATE:20261027',
        `UID:${'x'.repeat(600)}`,
      ),
    );
    expect(parseICal(text, ZONE)).toEqual([]);
  });

  it('marks STATUS:CANCELLED and ignores nested blocks', () => {
    const text = calendar(
      ...vevent(
        'DTSTART;VALUE=DATE:20261024',
        'DTEND;VALUE=DATE:20261027',
        'UID:c',
        'STATUS:CANCELLED',
        'BEGIN:VALARM',
        'SUMMARY:Alarm',
        'END:VALARM',
      ),
    );
    expect(parseICal(text, ZONE)).toMatchObject([{ uid: 'c', cancelled: true, summary: null }]);
  });

  it('rejects HTML and files with too many events', () => {
    expect(code(() => parseICal('<!doctype html><html>Log in</html>', ZONE))).toBe(
      'not-a-calendar',
    );
    const many = Array.from({ length: 2001 }, (_, i) =>
      vevent('DTSTART;VALUE=DATE:20261024', 'DTEND;VALUE=DATE:20261027', `UID:${i}`),
    ).flat();
    expect(code(() => parseICal(calendar(...many), ZONE))).toBe('too-large');
  });

  it('keeps the last of duplicate UIDs', () => {
    const text = calendar(
      ...vevent('DTSTART;VALUE=DATE:20261024', 'DTEND;VALUE=DATE:20261027', 'UID:d'),
      ...vevent('DTSTART;VALUE=DATE:20261025', 'DTEND;VALUE=DATE:20261029', 'UID:d'),
    );
    expect(parseICal(text, ZONE)).toMatchObject([
      { uid: 'd', checkIn: '2026-10-25', checkout: '2026-10-29' },
    ]);
  });
});
