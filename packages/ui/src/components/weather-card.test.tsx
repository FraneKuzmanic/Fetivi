// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { WeatherCardPayload } from '../payloads';
import { WeatherCard, type WeatherLabels } from './weather-card/WeatherCard';

let root: Root | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

function mount(node: React.ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(node));
  return host;
}

const LABELS: WeatherLabels = {
  heading: 'Weather',
  day: (date) => `Day ${date}`,
  today: 'Today',
  tomorrow: 'Tomorrow',
  tempRange: (min, max) => `${Math.round(min)}–${Math.round(max)} °C`,
  rain: (mm) => `${mm} mm rain`,
  wind: (ms) => `wind ${Math.round(ms)} m/s`,
  sea: (t, station) => `Sea ${t} °C at ${station}`,
  uv: (v, station) => `UV ${v} at ${station}`,
  warningLevel: (level) => `${level} warning`,
  warningTime: (onset, expires) => `${onset} to ${expires}`,
  warningsUnknown: 'Could not check official warnings right now.',
  noWarnings: 'No official warnings in force.',
  forecastUnavailable: 'The forecast is not available right now.',
  sources: 'Sources:',
  credit: (source) => (source === 'DHMZ' ? 'DHMZ (sea, UV, warnings)' : 'MET Norway (forecast)'),
  skyName: (sky) => `sky ${sky}`,
};

const REPORT: WeatherCardPayload = {
  date: '2027-07-15',
  timezone: 'Europe/Zagreb',
  days: [
    {
      date: '2027-07-15',
      sky: 'partly_cloudy',
      tempMinC: 21.2,
      tempMaxC: 29.4,
      precipitationMm: 0,
      windMaxMs: 7.6,
    },
    {
      date: '2027-07-16',
      sky: 'showers',
      tempMinC: 20.1,
      tempMaxC: 26.8,
      precipitationMm: 4.2,
      windMaxMs: 5.1,
    },
    {
      date: '2027-07-17',
      sky: 'clear',
      tempMinC: 22,
      tempMaxC: 30.3,
      precipitationMm: 0,
      windMaxMs: 3.4,
    },
  ],
  sea: { station: 'Split', temperatureC: 23.4, measuredAt: '2027-07-15T14:00' },
  uv: { station: 'Split', maxToday: 7.1, measuredAt: '2027-07-15T13:00' },
  warnings: [
    {
      level: 'yellow',
      type: 'wind',
      event: 'Yellow wind warning',
      description: 'Strong bura with gale-force gusts.',
      area: 'Middle Dalmatia region',
      onset: '2027-07-15T14:00:00.000Z',
      expires: '2027-07-15T21:59:59.000Z',
    },
  ],
  credits: [
    { source: 'DHMZ', label: 'Sea, UV and warnings: DHMZ', url: 'https://meteo.hr' },
    {
      source: 'MET Norway',
      label: 'Forecast: MET Norway (CC BY 4.0)',
      url: 'https://www.met.no/en',
    },
  ],
};

const NOW = new Date('2027-07-15T08:00:00Z');
const render = (report: WeatherCardPayload) =>
  mount(<WeatherCard report={report} labels={LABELS} now={NOW} />);

describe('WeatherCard', () => {
  it('shows three days, today and tomorrow by name, rain only when there is some', () => {
    const el = render(REPORT);
    const days = [...el.querySelectorAll('.fv-weather-day')].map((d) => d.textContent);
    expect(days).toHaveLength(3);
    expect(days[0]).toContain('Today');
    expect(days[0]).toContain('21–29 °C');
    expect(days[0]).not.toContain('mm rain');
    expect(days[1]).toContain('Tomorrow');
    expect(days[1]).toContain('4.2 mm rain');
    expect(days[2]).toContain('Day 2027-07-17');
    expect(days[2]).toContain('sky clear');
    expect(el.querySelector('h3')?.textContent).toBe('Weather');
  });

  it('puts warnings first, with the level in words and the description', () => {
    const el = render(REPORT);
    const warning = el.querySelector('.fv-weather-warning');
    expect(warning?.getAttribute('data-level')).toBe('yellow');
    expect(warning?.textContent).toContain('yellow warning');
    expect(warning?.textContent).toContain('Middle Dalmatia region');
    expect(warning?.textContent).toContain('Strong bura');
    expect(
      el
        .querySelector('.fv-weather-warnings')
        ?.compareDocumentPosition(el.querySelector('.fv-weather-days') as Node),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('says warnings could not be checked when they are null, and never "none"', () => {
    const el = render({ ...REPORT, warnings: null });
    expect(el.textContent).toContain('Could not check official warnings');
    expect(el.textContent).not.toContain('No official warnings');
  });

  it('shows no warning row when none are in force; the screen reader hears it', () => {
    const el = render({ ...REPORT, warnings: [] });
    expect(el.querySelector('.fv-weather-warnings')).toBeNull();
    expect(el.querySelector('.fv-visually-hidden')?.textContent).toBe(
      'No official warnings in force.',
    );
  });

  it('says the forecast is unavailable when days are null or past its end', () => {
    for (const days of [null, []]) {
      const el = render({ ...REPORT, days });
      expect(el.querySelector('.fv-weather-days')).toBeNull();
      expect(el.textContent).toContain('The forecast is not available right now.');
      act(() => root?.unmount());
      root = null;
    }
  });

  it('shows the sea and UV lines and hides a missing one', () => {
    expect(render(REPORT).textContent).toContain('Sea 23.4 °C at Split');
    act(() => root?.unmount());
    const el = render({ ...REPORT, sea: null });
    expect(el.textContent).not.toContain('Sea ');
    expect(el.textContent).toContain('UV 7.1 at Split');
  });

  it('credits both sources with links that open outside', () => {
    const links = [...render(REPORT).querySelectorAll('.fv-weather-credits a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      'https://meteo.hr',
      'https://www.met.no/en',
    ]);
    for (const a of links) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noreferrer');
    }
  });
});
