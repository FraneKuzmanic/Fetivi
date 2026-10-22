import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WeatherFeedError } from './errors';
import { dailyForecast, type ForecastStep, metnoUrl, parseLocationforecast, skyOf } from './metno';

const ZONE = 'Europe/Zagreb';
const recorded = JSON.parse(
  readFileSync(new URL('./recorded/metno-trogir.json', import.meta.url), 'utf8'),
);

function step(time: string, over: Partial<ForecastStep> = {}): ForecastStep {
  return {
    time,
    temperatureC: 20,
    windMs: 3,
    next1h: null,
    next6h: null,
    next12h: null,
    ...over,
  };
}
const rain = (mm: number, symbol = 'rain') => ({
  summary: { symbol_code: symbol },
  details: { precipitation_amount: mm },
});

describe('metnoUrl', () => {
  it('rounds the point to two decimals', () => {
    expect(metnoUrl({ lat: 43.5167, lng: 16.2511 })).toBe(
      'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=43.52&lon=16.25',
    );
  });
});

describe('parseLocationforecast', () => {
  it('reads the recorded Trogir forecast', () => {
    const { updatedAt, steps } = parseLocationforecast(recorded);
    expect(updatedAt).toBe('2026-10-22T19:17:33.000Z');
    expect(steps).toHaveLength(70);
    expect(steps[0]).toMatchObject({
      time: '2026-10-22T20:00:00.000Z',
      temperatureC: 12.7,
      windMs: 2.2,
    });
  });

  it('throws on an unexpected body', () => {
    expect(() => parseLocationforecast({ properties: {} })).toThrow(WeatherFeedError);
  });
});

describe('skyOf', () => {
  it.each([
    ['clearsky_day', 'clear'],
    ['fair_night', 'partly_cloudy'],
    ['partlycloudy_polartwilight', 'partly_cloudy'],
    ['cloudy', 'cloudy'],
    ['fog', 'fog'],
    ['lightrain', 'light_rain'],
    ['heavyrain', 'heavy_rain'],
    ['lightrainshowers_day', 'showers'],
    ['rainandthunder', 'thunder'],
    ['heavyrainshowersandthunder_night', 'thunder'],
    ['lightsleet', 'sleet'],
    ['snowshowers_day', 'snow'],
    ['something_new', 'cloudy'],
  ])('%s → %s', (code, sky) => {
    expect(skyOf(code)).toBe(sky);
  });
});

describe('dailyForecast', () => {
  const days = dailyForecast(parseLocationforecast(recorded).steps, ZONE);

  it('folds the recording into civil days in the zone', () => {
    expect(days.map((d) => d.date)).toEqual([
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
    ]);
  });

  it('marks the late-evening today as partial', () => {
    expect(days[0]).toEqual({
      date: '2026-10-22',
      sky: 'partly_cloudy',
      symbolCode: 'fair_night',
      tempMinC: 12.1,
      tempMaxC: 12.7,
      precipitationMm: 0,
      windMaxMs: 2.4,
      partial: true,
    });
  });

  it('computes a full day by hand', () => {
    // 22:00Z on the 22nd is midnight on the 23rd (CEST).
    expect(days[1]).toEqual({
      date: '2026-10-23',
      sky: 'partly_cloudy',
      symbolCode: 'partlycloudy_day',
      tempMinC: 10,
      tempMaxC: 19.1,
      precipitationMm: 0,
      windMaxMs: 3.3,
      partial: false,
    });
    expect(days[2]).toMatchObject({
      sky: 'showers',
      tempMinC: 11.6,
      tempMaxC: 18.2,
      precipitationMm: 5.7,
    });
  });

  it('handles the DST change and the 6-hourly tail', () => {
    // 25 October is 25 hours long; noon is 11:00Z.
    expect(days[3]).toMatchObject({ symbolCode: 'cloudy', tempMinC: 7.7, tempMaxC: 16.9 });
    expect(days[4]).toMatchObject({
      symbolCode: 'fair_day',
      tempMinC: 12,
      tempMaxC: 22.1,
      partial: false,
    });
  });

  it('never counts the 6-hourly tail twice', () => {
    const [day] = dailyForecast(
      [
        step('2026-07-10T08:00:00Z', { next1h: rain(1), next6h: rain(5) }),
        step('2026-07-10T09:00:00Z', { next6h: rain(3) }),
        // Inside the six hours the step above covers: adds nothing.
        step('2026-07-10T12:00:00Z', { next6h: rain(9) }),
        step('2026-07-10T15:00:00Z', { next6h: rain(2) }),
      ],
      ZONE,
    );
    expect(day?.precipitationMm).toBe(6);
  });

  it('drops a day with no symbol at all', () => {
    expect(dailyForecast([step('2026-07-10T08:00:00Z')], ZONE)).toEqual([]);
  });
});
