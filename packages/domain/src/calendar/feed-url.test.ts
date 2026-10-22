import { isAllowedUrl } from '@fetivi/egress';
import { describe, expect, it } from 'vitest';
import { CalendarRuleError } from './errors';
import { feedLabel, parseFeedUrl } from './feed-url';
import { CALENDAR_HOSTS } from './vocabulary';

const code = (raw: string) => {
  try {
    parseFeedUrl(raw);
    return 'ok';
  } catch (error) {
    return error instanceof CalendarRuleError ? error.code : String(error);
  }
};

describe('parseFeedUrl', () => {
  it('rewrites Airbnb country domains to www.airbnb.com', () => {
    expect(parseFeedUrl(' https://www.airbnb.co.uk/calendar/ical/1.ics?s=abc#x ')).toEqual({
      url: 'https://www.airbnb.com/calendar/ical/1.ics?s=abc',
      source: 'airbnb',
    });
    expect(parseFeedUrl('https://airbnb.hr/calendar/ical/1.ics?s=x').url).toBe(
      'https://www.airbnb.com/calendar/ical/1.ics?s=x',
    );
  });

  it('detects Booking.com', () => {
    expect(parseFeedUrl('https://ical.booking.com/v1/export?t=abc')).toEqual({
      url: 'https://ical.booking.com/v1/export?t=abc',
      source: 'booking',
    });
    expect(parseFeedUrl('https://admin.booking.com/hotel/hoteladmin/ical.html?t=1').source).toBe(
      'booking',
    );
  });

  it.each([
    'http://www.airbnb.com/calendar/ical/1.ics?s=x',
    'https://evil.com/calendar/ical/1.ics',
    'https://airbnb.com.evil.com/calendar/ical/1.ics',
    'https://www.airbnb.com/rooms/1',
    'https://user:pw@ical.booking.com/v1/export?t=a',
    'https://ical.booking.com:8443/v1/export?t=a',
    'not a url',
    `https://ical.booking.com/v1/export?t=${'a'.repeat(2049)}`,
  ])('rejects %s', (raw) => {
    expect(code(raw)).toBe('invalid-calendar-url');
  });

  it('accepts only URLs the jobs allowlist lets through', () => {
    for (const raw of [
      'https://www.airbnb.de/calendar/ical/1.ics?s=x',
      'https://ical.booking.com/v1/export?t=abc',
      'https://admin.booking.com/x?t=1',
    ]) {
      expect(isAllowedUrl(new URL(parseFeedUrl(raw).url), { allowlist: CALENDAR_HOSTS })).toBe(
        null,
      );
    }
  });
});

describe('feedLabel', () => {
  it('drops the query string', () => {
    expect(feedLabel('https://www.airbnb.com/calendar/ical/123.ics?s=secret')).toBe(
      'www.airbnb.com/calendar/ical/123.ics',
    );
  });
});
