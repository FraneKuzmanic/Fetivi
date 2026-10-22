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
