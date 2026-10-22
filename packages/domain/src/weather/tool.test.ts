import { describe, expect, it } from 'vitest';
import { sampleWeatherReport } from '../testing/weather';
import type { WeatherPlace } from './source';
import { WeatherDateError, weatherToolDate, weatherToolResult } from './tool';
import { WEATHER_CREDITS } from './vocabulary';

const PLACE: WeatherPlace = { lat: 43.5167, lng: 16.2511, timezone: 'Europe/Zagreb' };
// 23:30 in Zagreb on 14 July: already the 14th locally, still the 14th in UTC too.
const NOW = new Date('2026-07-14T21:30:00Z');

describe('weatherToolDate', () => {
  it('defaults to today at the place, in its zone', () => {
    expect(weatherToolDate(PLACE, undefined, new Date('2026-07-14T22:30:00Z'))).toBe('2026-07-15');
    expect(weatherToolDate(PLACE, undefined, NOW)).toBe('2026-07-14');
  });

  it('accepts today up to 8 days ahead', () => {
    expect(weatherToolDate(PLACE, '2026-07-22', NOW)).toBe('2026-07-22');
  });

  it('refuses a past day and one beyond 8 days', () => {
    expect(() => weatherToolDate(PLACE, '2026-07-13', NOW)).toThrow(
      expect.objectContaining({ reason: 'past' }),
    );
    expect(() => weatherToolDate(PLACE, '2026-07-23', NOW)).toThrow(WeatherDateError);
    expect(() => weatherToolDate(PLACE, '2026-07-23', NOW)).toThrow(
      expect.objectContaining({ reason: 'too_far' }),
    );
  });
});

describe('weatherToolResult', () => {
  const report = sampleWeatherReport('2026-07-14');
  const noon = new Date('2026-07-14T10:00:00Z');

  it('carries the asked day and the next two, sea, UV, warnings and credits', () => {
    const result = weatherToolResult(report, PLACE, '2026-07-14', noon);
    expect(result.date).toBe('2026-07-14');
    expect(result.timezone).toBe('Europe/Zagreb');
    expect(result.days?.map((d) => d.date)).toEqual(['2026-07-14', '2026-07-15', '2026-07-16']);
    expect(result.forecastUpdatedAt).toBe(report.forecast?.updatedAt);
    expect(result.sea).toEqual(report.sea);
    expect(result.uv).toEqual(report.uv);
    expect(result.warnings).toEqual(report.warnings);
    expect(result.credits).toEqual([...WEATHER_CREDITS]);
  });

  it('starts the days at the asked date and gives [] past the forecast', () => {
    expect(weatherToolResult(report, PLACE, '2026-07-15', noon).days?.map((d) => d.date)).toEqual([
      '2026-07-15',
      '2026-07-16',
    ]);
    expect(weatherToolResult(report, PLACE, '2026-07-20', noon).days).toEqual([]);
  });

  it('keeps the nulls: forecast and warnings that could not be checked', () => {
    const result = weatherToolResult(
      { ...report, forecast: null, warnings: null },
      PLACE,
      '2026-07-14',
      noon,
    );
    expect(result.days).toBeNull();
    expect(result.forecastUpdatedAt).toBeNull();
    expect(result.warnings).toBeNull();
  });

  it('drops warnings that expired or start after the returned days', () => {
    // Today's wind warning ends at midnight: gone by the next morning, and not over days 3-5.
    expect(
      weatherToolResult(report, PLACE, '2026-07-15', new Date('2026-07-15T06:00:00Z')).warnings,
    ).toEqual([]);
    expect(weatherToolResult(report, PLACE, '2026-07-14', noon).warnings).toHaveLength(1);
    const later = {
      ...report,
      warnings: report.warnings?.map((w) => ({
        ...w,
        onset: '2026-07-17T08:00:00.000Z',
        expires: '2026-07-17T18:00:00.000Z',
      })),
    } as typeof report;
    expect(weatherToolResult(later, PLACE, '2026-07-14', noon).warnings).toEqual([]);
    expect(weatherToolResult(later, PLACE, '2026-07-15', noon).warnings).toHaveLength(1);
  });
});
