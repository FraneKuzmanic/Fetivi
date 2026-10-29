// @vitest-environment happy-dom
import type { InboxItem } from '@fetivi/ui/payloads';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import '../../i18n';
import { InboxPart } from './InboxPart';

type Notice = Extract<InboxItem, { kind: 'notice' }>;
type Safety = NonNullable<Notice['safety']>;

const ZONE = 'Europe/Zagreb';
const bolTrip = {
  title: 'Bol day trip',
  date: '2026-10-15',
  startTime: '09:00',
  orderId: null,
  lines: ['9603' as const],
};

const notice = (notification: Notice['notification'], safety: Safety): InboxItem => ({
  kind: 'notice',
  notification,
  orderId: null,
  offerTitle: null,
  date: null,
  startTime: null,
  checkoutTime: null,
  reviewPlatform: null,
  reviewUrl: null,
  safety,
  tip: null,
  freeCancellationEnded: false,
  at: '2026-10-14T10:00:00Z',
});

const warning = (over: Partial<Extract<Safety, { source: 'DHMZ' }>> = {}): Safety => ({
  source: 'DHMZ',
  level: 'orange',
  type: 'wind',
  event: 'Orange wind warning',
  description: 'Bura gusts up to 100 km/h.',
  area: 'Middle Dalmatia region',
  onset: '2026-10-15T04:00:00.000Z',
  expires: '2026-10-15T21:59:59.000Z',
  timezone: ZONE,
  advisory: null,
  ...over,
});

const ferry = (orderId: string | null): Safety => ({
  source: 'Jadrolinija',
  bulletinId: 'urn:uuid:81',
  title: 'Linije u prekidu, 15.10.2026',
  url: 'https://www.jadrolinija.hr/hr/novost/linije-u-prekidu15102026',
  timezone: ZONE,
  affected: { ...bolTrip, orderId },
});

const html = (item: InboxItem) =>
  renderToString(
    <MemoryRouter>
      <InboxPart item={item} />
    </MemoryRouter>,
  );

describe('InboxPart safety notices', () => {
  it("quotes DHMZ's warning with its level, area and time, and no advisory by default", () => {
    const out = html(notice('weather_warning', warning()));
    expect(out).toContain('data-level="orange"');
    expect(out).toContain('Orange warning');
    expect(out).toContain('DHMZ, the Croatian weather service, has issued a warning for');
    expect(out).toContain('Middle Dalmatia region');
    expect(out).toContain('<blockquote');
    expect(out).toContain('Orange wind warning. Bura gusts up to 100 km/h.');
    expect(out).toContain('href="https://meteo.hr"');
    expect(out).not.toContain('Sea conditions');
    // Weather warnings link nowhere in the app.
    expect(out).not.toContain('href="/trip"');
  });

  it('adds the sailing advisory with the operator link for a wind warning on a ferry day', () => {
    const out = html(notice('weather_warning', warning({ advisory: bolTrip })));
    expect(out).toContain('Sea conditions may disrupt sailings on line 9603 (Bol day trip');
    expect(out).toContain('Check with Jadrolinija before you go.');
    expect(out).toContain('href="https://www.jadrolinija.hr/hr/obavijesti/stanje-u-prometu/"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it("quotes Jadrolinija's notice as published, never in Fetivi's voice", () => {
    const out = html(notice('ferry_disruption', ferry(null)));
    expect(out).toContain('Jadrolinija&#x27;s notice says:');
    expect(out).toContain('Linije u prekidu, 15.10.2026');
    expect(out).toContain('It may affect Bol day trip on');
    expect(out).toContain('(line 9603)');
    expect(out).toContain('href="https://www.jadrolinija.hr/hr/novost/linije-u-prekidu15102026"');
    expect(out).toContain('Read Jadrolinija&#x27;s notice');
    expect(out).toContain('href="/trip"');
    expect(out).not.toContain('booking stays');
    expect(out.toLowerCase()).not.toMatch(/cancel|suspend/);
  });

  it('says a booking stands unless the provider cancels it', () => {
    const out = html(notice('ferry_disruption', ferry('o-1')));
    expect(out).toContain('Your booking stays as it is unless the provider cancels it.');
  });
});

type Tip = NonNullable<Notice['tip']>;

const tipNotice = (over: Partial<Tip>): InboxItem => ({
  ...(notice('daily_tip', null as unknown as Safety) as Notice),
  safety: null,
  tip: {
    rule: 'gap',
    date: '2026-10-15',
    recordId: 'r-1',
    kind: 'place',
    title: 'Cathedral of St Lawrence',
    startsAt: null,
    venueName: null,
    distanceKm: null,
    ...over,
  },
});

describe('InboxPart daily tips', () => {
  it('words a rain tip with the place, tomorrow and its distance', () => {
    const out = html(tipNotice({ rule: 'rain', distanceKm: 1.24 }));
    expect(out).toContain('It looks like rain tomorrow, Oct 15, 2026.');
    expect(out).toContain('Cathedral of St Lawrence is a good place to spend it (1.2 km away).');
    expect(out).toContain('class="bubble fetivi notice"');
  });

  it('words an event tip with its time when it starts tomorrow, and the venue', () => {
    const out = html(
      tipNotice({
        rule: 'event',
        kind: 'event',
        title: 'Trogir Summer of Culture',
        startsAt: '2026-10-15T20:00',
        venueName: 'Kamerlengo Fortress',
      }),
    );
    expect(out).toContain('Trogir Summer of Culture is on tomorrow, Oct 15, 2026');
    expect(out).toContain('8:00');
    expect(out).toContain(', at Kamerlengo Fortress.');
  });

  it('shows only the date for an event already running', () => {
    const out = html(
      tipNotice({ rule: 'event', kind: 'event', startsAt: '2026-07-01T20:00', venueName: null }),
    );
    expect(out).toContain('is on tomorrow, Oct 15, 2026.');
    expect(out).not.toContain('8:00');
  });

  it('words a gap tip as an invitation to ask, with no link out of the Chat', () => {
    const out = html(tipNotice({ rule: 'gap' }));
    expect(out).toContain('Tomorrow, Oct 15, 2026, is still free in your plan.');
    expect(out).toContain(
      'How about Cathedral of St Lawrence? Ask me and I&#x27;ll tell you more.',
    );
    expect(out).not.toContain('<a ');
  });

  it('shows nothing for a tip notice without its facts', () => {
    expect(html({ ...(tipNotice({}) as Notice), tip: null })).toBe('');
  });
});

describe('InboxPart order notices', () => {
  const confirmed = (freeCancellationEnded: boolean): InboxItem => ({
    ...(notice('order_confirmed', warning()) as Notice),
    safety: null,
    offerTitle: 'Olive oil',
    date: '2026-10-15',
    freeCancellationEnded,
  });

  it('says cancelling is no longer free when the request was accepted after its window', () => {
    expect(html(confirmed(true))).toContain(
      'It was accepted after the free cancellation window, so cancelling it is no longer free.',
    );
    expect(html(confirmed(false))).not.toContain('no longer free');
  });
});
