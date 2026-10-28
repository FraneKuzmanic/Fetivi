import type { UIMessage } from 'ai';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { Space } from '../../api';
import { SpaceProvider } from '../../space';
import { ChatView } from '../ChatTab';

const space = (closed: boolean): Space => ({
  language: 'en',
  closedAt: '2026-10-26T23:00:00.000Z',
  closed,
  unitSlug: 'qrabc',
  keepForEvaluation: false,
});

const render = (initial: UIMessage[], closed = false) =>
  renderToString(
    <MemoryRouter>
      <SpaceProvider initial={{ status: 'ready', space: space(closed) }}>
        <ChatView initial={initial} />
      </SpaceProvider>
    </MemoryRouter>,
  );

const card = (id: string, title: string) => ({
  id,
  kind: 'place',
  category: 'restaurant',
  title,
  summary: 'Grilled fish.',
  location: { lat: 43.517, lng: 16.251 },
  distanceKm: 0.4,
  travelMinutes: null,
  image: null,
  verifiedAt: null,
  staleness: { status: 'fresh' },
});

const carousel = (places: unknown[]) =>
  ({
    type: 'data-component',
    id: 'c1',
    data: { name: 'place-carousel', payload: { places } },
  }) as const;
const chips = {
  type: 'data-component',
  id: 'c2',
  data: { name: 'follow-up-chips', payload: { replies: ['Show me on a map'] } },
} as const;

const question: UIMessage = {
  id: 'u1',
  role: 'user',
  parts: [{ type: 'text', text: 'Where should we eat tonight?' }],
};
const answer = (parts: unknown[]): UIMessage => ({
  id: 'a1',
  role: 'assistant',
  parts: [{ type: 'text', text: 'Try Konoba Mala.' }, ...parts] as UIMessage['parts'],
});
const later: UIMessage[] = [
  { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'Thanks' }] },
  { id: 'a2', role: 'assistant', parts: [{ type: 'text', text: 'Enjoy!' }] },
];

describe('component parts in the chat', () => {
  it('renders the bubble, the carousel and the chips of the newest answer', () => {
    const html = render([
      question,
      answer([carousel([card('p1', 'Konoba Mala'), card('p2', 'Konoba Velika')]), chips]),
    ]);
    expect(html).toContain('Try Konoba Mala.');
    expect(html).toContain('class="fv-carousel"');
    expect(html.indexOf('Konoba Mala</h3>')).toBeLessThan(html.indexOf('Konoba Velika</h3>'));
    expect(html).toContain('aria-label="Suggested replies"');
    expect(html).toContain('>Show me on a map</button>');
    expect(html).toContain('>Save</button>');
  });

  it('renders found events as a numbered list with its map', () => {
    const event = {
      id: 'e1',
      title: 'Klapa night',
      startsAt: '2027-07-10T21:00',
      endsAt: '2027-07-10T23:00',
      venueName: 'Kamerlengo Fortress',
      address: null,
      location: { lat: 43.5161, lng: 16.2475 },
      distanceKm: 0.4,
    };
    const html = render([
      question,
      answer([
        {
          type: 'data-component',
          id: 'c3',
          data: { name: 'event-list', payload: { events: [event] } },
        },
      ]),
    ]);
    expect(html).toContain('aria-label="Events"');
    expect(html).toContain('Klapa night');
    expect(html).toContain('Kamerlengo Fortress · 0.4 km');
    expect(html).toContain('class="fv-map" aria-hidden="true"');
  });

  it('puts the words before cards the model showed first', () => {
    const html = render([
      question,
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          carousel([card('p1', 'Konoba Mala')]),
          { type: 'text', text: 'Konoba Mala is my pick.' },
          { type: 'text', text: 'Book ahead.' },
        ] as UIMessage['parts'],
      },
    ]);
    expect(html.indexOf('Konoba Mala is my pick.')).toBeLessThan(
      html.indexOf('class="fv-carousel"'),
    );
    // The welcome's bubble, then the answer's words in one bubble.
    expect(html.match(/class="bubble fetivi"/g)).toHaveLength(2);
  });

  it('puts chips after text written after them', () => {
    const html = render([
      question,
      {
        id: 'a1',
        role: 'assistant',
        parts: [chips, { type: 'text', text: 'Try Konoba Mala.' }] as UIMessage['parts'],
      },
    ]);
    expect(html.indexOf('Try Konoba Mala.')).toBeLessThan(html.indexOf('Suggested replies'));
  });

  it('hides chips on an older answer', () => {
    const html = render([
      question,
      answer([carousel([card('p1', 'Konoba Mala')]), chips]),
      ...later,
    ]);
    expect(html).toContain('class="fv-carousel"');
    expect(html).not.toContain('Suggested replies');
  });

  it('skips an invalid or unknown payload and keeps the text', () => {
    const html = render([
      question,
      answer([
        carousel([]),
        { type: 'data-component', id: 'c3', data: { name: 'weather', payload: {} } },
      ]),
    ]);
    expect(html).toContain('Try Konoba Mala.');
    expect(html).not.toContain('fv-carousel');
  });

  it('after the Stay shows no chips and no Save on unsaved places', () => {
    const html = render([question, answer([carousel([card('p1', 'Konoba Mala')]), chips])], true);
    expect(html).toContain('class="fv-carousel"');
    expect(html).not.toContain('Suggested replies');
    expect(html).not.toContain('fv-save');
  });
});

describe('property info card in the chat', () => {
  it('renders a property-info part as the card, with copy buttons', () => {
    const info = {
      type: 'data-component',
      id: 'c9',
      data: {
        name: 'property-info',
        payload: {
          topic: 'wifi',
          releaseAt: null,
          timezone: 'Europe/Zagreb',
          fields: [
            { key: 'wifiNetwork', value: 'Mare', action: 'copy' },
            { key: 'wifiPassword', value: 'sea-breeze', action: 'copy' },
          ],
          media: [],
        },
      },
    } as const;
    const html = render([question, answer([info])]);
    expect(html).toContain('class="fv-info"');
    expect(html).toContain('>sea-breeze</code>');
    expect(html).toContain('Copy Password');
  });
});

describe('day plan in the chat', () => {
  const item = (id: string, title: string, time: string | null) => ({
    id,
    kind: 'suggestion',
    date: '2027-07-15',
    time,
    title,
    note: null,
    placeId: null,
    offerId: null,
    orderId: null,
    orderStatus: null,
  });
  const plan = (id: string, days: { date: string; items: unknown[] }[]) =>
    ({
      type: 'data-component',
      id,
      data: {
        name: 'day-plan',
        payload: { checkIn: '2027-07-14', checkout: '2027-07-16', today: '2027-07-15', days },
      },
    }) as const;

  it('shows only the last timeline of an answer, without empty days or Ask buttons', () => {
    const html = render([
      question,
      answer([
        plan('p1', [{ date: '2027-07-15', items: [item('a', 'Old swim', null)] }]),
        plan('p2', [
          { date: '2027-07-14', items: [] },
          { date: '2027-07-15', items: [item('a', 'Morning swim', '08:00')] },
        ]),
      ]),
    ]);
    expect(html.match(/class="fv-plan"/g)).toHaveLength(1);
    expect(html).toContain('Morning swim');
    expect(html).not.toContain('Old swim');
    expect(html).not.toContain('Nothing planned yet');
    expect(html).not.toContain('Ask Fetivi');
  });

  it('shows an empty day when one day was asked for', () => {
    const html = render([question, answer([plan('p1', [{ date: '2027-07-15', items: [] }])])]);
    expect(html).toContain('Thursday, July 15');
    expect(html).toContain('Nothing planned yet');
  });

  it('shows every empty day when nothing is planned in the whole stay', () => {
    const html = render([
      question,
      answer([
        plan('p1', [
          { date: '2027-07-14', items: [] },
          { date: '2027-07-15', items: [] },
        ]),
      ]),
    ]);
    expect(html).toContain('Wednesday, July 14');
    expect(html).toContain('Thursday, July 15');
    expect(html.match(/Nothing planned yet/g)).toHaveLength(2);
  });
});

describe('weather card in the chat', () => {
  const weather = (warnings: unknown[] | null) =>
    ({
      type: 'data-component',
      id: 'w1',
      data: {
        name: 'weather',
        payload: {
          date: '2027-07-15',
          timezone: 'Europe/Zagreb',
          days: [
            {
              date: '2027-07-15',
              sky: 'showers',
              tempMinC: 20.1,
              tempMaxC: 26.8,
              precipitationMm: 4.2,
              windMaxMs: 5.1,
            },
          ],
          sea: { station: 'Split', temperatureC: 23.4, measuredAt: '2027-07-15T14:00' },
          uv: { station: 'Split', maxToday: 7.1, measuredAt: '2027-07-15T13:00' },
          warnings,
          credits: [
            { source: 'DHMZ', label: 'Sea, UV and warnings: DHMZ', url: 'https://meteo.hr' },
            { source: 'MET Norway', label: 'Forecast: MET Norway', url: 'https://www.met.no/en' },
          ],
        },
      },
    }) as const;
  const wind = {
    level: 'orange',
    type: 'wind',
    event: 'Orange wind warning',
    description: 'Severe bura gusts.',
    area: 'Middle Dalmatia region',
    onset: '2027-07-15T14:00:00.000Z',
    expires: '2027-07-15T21:59:59.000Z',
  };

  it('renders a stored weather part as the card, the warning level in words', () => {
    const html = render([question, answer([weather([wind])])]);
    expect(html).toContain('Weather');
    expect(html).toContain('Orange warning');
    expect(html).toContain('Severe bura gusts.');
    expect(html).toContain('Thu 4:00 PM – 11:59 PM');
    expect(html).toContain('20–27 °C');
    expect(html).toContain('4.2 mm rain');
    expect(html).toContain('Sea 23 °C at Split');
    expect(html).toContain('UV up to 7 today (high) at Split');
    expect(html).toContain('href="https://www.met.no/en"');
    expect(html).toContain('MET Norway (forecast, CC BY 4.0)');
  });

  it('says warnings could not be checked when they are unknown', () => {
    const html = render([question, answer([weather(null)])]);
    expect(html).toContain('the official weather warnings just now.');
  });
});

describe('web results in the chat', () => {
  const results = {
    type: 'data-component',
    id: 'r1',
    data: {
      name: 'web-results',
      payload: {
        results: [
          {
            title: 'Kayaking around Trogir',
            snippet: 'Sea kayak tours around Čiovo.',
            url: 'https://www.visittrogir.hr/en/kayak',
            source: { host: 'visittrogir.hr', kind: 'tourist_board' },
          },
        ],
      },
    },
  } as const;

  it('renders a stored web-results part as links with source chips, not place cards', () => {
    const html = render([question, answer([results])]);
    expect(html).toContain('From the web');
    expect(html).toContain('Not checked by Fetivi.');
    expect(html).toContain('href="https://www.visittrogir.hr/en/kayak"');
    expect(html).toContain('visittrogir.hr');
    expect(html).toContain('Tourist board');
    expect(html).not.toContain('fv-place-card');
  });
});
