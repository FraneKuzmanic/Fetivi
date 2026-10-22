import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { recordedWeatherFetch, WEATHER_RECORDED_AT } from '../testing/weather';
import { DHMZ_FEEDS } from './dhmz';
import { WeatherFeedError, WeatherUnavailableError } from './errors';
import { metnoUrl } from './metno';
import { createWeatherSource, type WeatherPlace } from './source';

const AGENT = 'Fetivi/0.1 (+https://github.com/FraneKuzmanic/Fetivi)';
const ZONE = 'Europe/Zagreb';
const TROGIR: WeatherPlace = { lat: 43.5167, lng: 16.2511, timezone: ZONE };
const PULA: WeatherPlace = { lat: 44.87, lng: 13.85, timezone: ZONE };
const OPATIJA: WeatherPlace = { lat: 45.34, lng: 14.31, timezone: ZONE };
const ZAGREB: WeatherPlace = { lat: 45.815, lng: 15.982, timezone: ZONE };
const NOW = WEATHER_RECORDED_AT;

function source(options: Parameters<typeof recordedWeatherFetch>[0] = {}) {
  const fetch = recordedWeatherFetch(options);
  return { fetch, weather: createWeatherSource({ fetch, userAgent: AGENT, clock: () => NOW }) };
}

describe('createWeatherSource', () => {
  it('reports Trogir from the recordings', async () => {
    const report = await source().weather.report(TROGIR, 'en', NOW);
    expect(report.fetchedAt).toBe(NOW.toISOString());
    expect(report.forecast?.updatedAt).toBe('2026-10-22T19:17:33.000Z');
    expect(report.forecast?.days.map((d) => d.date)).toEqual([
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
    ]);
    expect(report.sea).toEqual({
      station: 'Split',
      temperatureC: 20,
      measuredAt: '2026-10-22T14:00',
    });
    // In October DHMZ has no UV station near Split.
    expect(report.uv).toBeNull();
    expect(report.warnings).toEqual([
      {
        level: 'yellow',
        type: 'wind',
        event: 'Yellow wind warning',
        description: expect.any(String),
        area: 'Middle Dalmatia region',
        onset: '2026-10-22T14:00:00.000Z',
        expires: '2026-10-22T21:59:59.000Z',
      },
      {
        level: 'yellow',
        type: 'thunderstorm',
        event: 'Yellow thunderstorm warning',
        description: expect.any(String),
        area: 'Splitsko-dalmatinska',
        onset: '2026-10-24T04:00:00.000Z',
        expires: '2026-10-24T21:59:59.000Z',
      },
    ]);
  });

  it('gives warning text in Croatian for hr', async () => {
    const report = await source().weather.report(TROGIR, 'hr', NOW);
    expect(report.warnings?.map((w) => [w.event, w.area])).toEqual([
      ['Žuto upozorenje za vjetar', 'Srednja Dalmacija'],
      ['Žuto upozorenje za grmljavinsku oluju', 'Splitsko-dalmatinska'],
    ]);
  });

  it('shows a warning repeated across the three feeds once', async () => {
    const body = readFileSync(new URL('./recorded/cap_hr_today.xml', import.meta.url), 'utf8');
    const report = await source({
      bodies: { [DHMZ_FEEDS.warnings[1]]: body, [DHMZ_FEEDS.warnings[2]]: body },
    }).weather.report(TROGIR, 'en', NOW);
    expect(report.warnings).toHaveLength(1);
  });

  it('drops warnings that have expired', async () => {
    // Istria's land warning ended at 17:00; the West Istrian coast one runs to midnight.
    const report = await source().weather.report(PULA, 'en', NOW);
    const today = report.warnings?.filter((w) => w.expires.startsWith('2026-10-22')) ?? [];
    expect(today.map((w) => w.area)).toEqual(['West Istrian coast']);
    expect(report.warnings?.every((w) => Date.parse(w.expires) > NOW.getTime())).toBe(true);
  });

  it("takes the station's highest UV today", async () => {
    const report = await source().weather.report(OPATIJA, 'en', NOW);
    expect(report.uv).toEqual({
      station: 'Opatija',
      maxToday: 0.8,
      measuredAt: '2026-10-22T15:00',
    });
  });

  it('falls back to the next station when the nearest has no reading', async () => {
    // Crikvenica's sea row is all '-'; Malinska is next.
    const report = await source().weather.report(
      { lat: 45.17, lng: 14.69, timezone: ZONE },
      'en',
      NOW,
    );
    expect(report.sea?.station).toBe('Malinska');
  });

  it("gives no sea or UV from yesterday's table", async () => {
    const sameDay = await source().weather.report(OPATIJA, 'en', NOW);
    expect(sameDay.sea).not.toBeNull();
    expect(sameDay.uv).not.toBeNull();
    // 00:30 on 23 October in Zagreb, before DHMZ's first update of the day.
    const report = await source().weather.report(OPATIJA, 'en', new Date('2026-10-22T22:30:00Z'));
    expect(report.sea).toBeNull();
    expect(report.uv).toBeNull();
  });

  it('keeps the other parts when MET Norway is down', async () => {
    const report = await source({ down: ['https://api.met.no/'] }).weather.report(
      TROGIR,
      'en',
      NOW,
    );
    expect(report.forecast).toBeNull();
    expect(report.sea?.station).toBe('Split');
    expect(report.warnings).toHaveLength(2);
  });

  it('gives null warnings, never [], when one CAP feed fails', async () => {
    const report = await source({ down: [DHMZ_FEEDS.warnings[2]] }).weather.report(
      TROGIR,
      'en',
      NOW,
    );
    expect(report.warnings).toBeNull();
    expect(report.forecast).not.toBeNull();
  });

  it('knows no warnings, sea or UV inland', async () => {
    const report = await source().weather.report(ZAGREB, 'en', NOW);
    expect(report.warnings).toBeNull();
    expect(report.sea).toBeNull();
    expect(report.forecast).not.toBeNull();
  });

  it('throws WeatherUnavailableError when every part fails', async () => {
    const { weather } = source({ down: ['https://'] });
    await expect(weather.report(TROGIR, 'en', NOW)).rejects.toThrow(WeatherUnavailableError);
  });

  it('answers warnings alone, null without a warning area, and throws when a feed is down', async () => {
    const { fetch, weather } = source();
    const warnings = await weather.warnings(TROGIR, 'en', NOW);
    expect(warnings?.map((w) => w.type)).toEqual(['wind', 'thunderstorm']);
    expect(fetch.urls.every((url) => url.startsWith('https://meteo.hr/'))).toBe(true);
    expect(await weather.warnings(ZAGREB, 'en', NOW)).toBeNull();
    const down = source({ down: [DHMZ_FEEDS.warnings[1]] }).weather;
    await expect(down.warnings(TROGIR, 'en', NOW)).rejects.toThrow(WeatherFeedError);
  });

  it('reuses the cache across reports', async () => {
    const { fetch, weather } = source();
    await weather.report(TROGIR, 'en', NOW);
    const first = fetch.urls.length;
    await weather.report(TROGIR, 'hr', NOW);
    expect(first).toBe(6);
    expect(fetch.urls).toHaveLength(6);
  });
});

describe('weather hosts', () => {
  // AC5: Open-Meteo's licence rules it out; only DHMZ and MET Norway are ever asked.
  it('asks only vrijeme.hr, meteo.hr and api.met.no', () => {
    const urls = [
      DHMZ_FEEDS.sea,
      DHMZ_FEEDS.uv,
      ...DHMZ_FEEDS.warnings,
      metnoUrl({ lat: TROGIR.lat, lng: TROGIR.lng }),
    ];
    expect([...new Set(urls.map((u) => new URL(u).hostname))].sort()).toEqual([
      'api.met.no',
      'meteo.hr',
      'vrijeme.hr',
    ]);
  });
});
