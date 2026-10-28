import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { componentPart, type EventCardPayload } from '../payloads';
import { EventList, eventWhen } from './event-list/EventList';
import { LABELS } from './fixtures';

const event = (over: Partial<EventCardPayload> = {}): EventCardPayload => ({
  id: 'e1',
  title: 'Klapa night',
  startsAt: '2027-07-10T21:00',
  endsAt: '2027-07-10T23:00',
  venueName: 'Kamerlengo Fortress',
  address: null,
  location: { lat: 43.5161, lng: 16.2475 },
  distanceKm: 0.43,
  ...over,
});

const labels = { ...LABELS, places: 'Events' };

describe('eventWhen', () => {
  it('shows the day and start time as written, with no zone shift', () => {
    expect(eventWhen('2027-07-10T21:00', '2027-07-10T23:00', 'en-GB')).toBe('Sat 10 Jul, 21:00');
  });

  it('writes the hour as the language does, without a padded 12-hour clock', () => {
    const when = (locale: string) =>
      eventWhen('2027-07-10T08:00', '2027-07-10T10:00', locale).replace(/\s/g, ' ');
    expect(when('en')).toBe('Sat, Jul 10, 8:00 AM');
    expect(when('hr')).toMatch(/ 8:00$/);
  });

  it('shows the date range of an event over several days', () => {
    // Intl puts thin spaces around the dash; compare with plain ones.
    expect(eventWhen('2027-07-01T20:00', '2027-08-31T23:00', 'en-GB').replace(/\s/g, ' ')).toBe(
      '1 Jul – 31 Aug',
    );
  });
});

describe('EventList', () => {
  it('lists events in order with when, where and how far, and a map', () => {
    const html = renderToString(
      <EventList
        events={[
          event(),
          event({ id: 'e2', title: 'Fish night', venueName: null, address: 'Obala 2' }),
        ]}
        labels={labels}
        locale="en-GB"
      />,
    );
    expect(html).toContain('aria-label="Events"');
    expect(html.indexOf('Klapa night')).toBeLessThan(html.indexOf('Fish night'));
    expect(html).toContain('Sat 10 Jul, 21:00 · Kamerlengo Fortress · 0.4 km away');
    expect(html).toContain('Obala 2');
    expect(html).toContain('class="fv-map" aria-hidden="true"');
  });

  it('shows the list without a map when no event has a location', () => {
    const html = renderToString(
      <EventList
        events={[event({ location: null, distanceKm: null })]}
        labels={labels}
        locale="en-GB"
      />,
    );
    expect(html).toContain('Klapa night');
    expect(html).not.toContain('class="fv-map"');
  });
});

describe('event-list payload', () => {
  it('takes search_events output and refuses an empty list', () => {
    const ok = componentPart.safeParse({
      name: 'event-list',
      payload: { events: [{ ...event(), summary: 'extra fields are kept out' }] },
    });
    expect(ok.success).toBe(true);
    expect(componentPart.safeParse({ name: 'event-list', payload: { events: [] } }).success).toBe(
      false,
    );
  });
});
