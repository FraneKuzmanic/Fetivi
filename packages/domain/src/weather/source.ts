import type { Egress } from '@fetivi/egress';
import { DateTime } from 'luxon';
import { byDistance, type GeoPoint, SEA_STATIONS, UV_STATIONS, warningAreasAt } from './areas';
import { createFeedCache, FEED_POLICIES } from './cache';
import {
  type CapWarning,
  DHMZ_FEEDS,
  latestReading,
  maxReading,
  parseCapWarnings,
  parseStationTable,
} from './dhmz';
import { WeatherUnavailableError } from './errors';
import { dailyForecast, type ForecastDay, metnoUrl, parseLocationforecast } from './metno';
import { WARNING_LEVELS, type WarningLevel, type WarningType, WEATHER_LIMITS } from './vocabulary';

// One weather report for a property, from four independent upstreams: the MET Norway forecast,
// and DHMZ sea temperature, UV and warnings. Each part fails on its own to null, meaning
// "could not check"; only when all four fail does the report throw. `warnings: []` means DHMZ
// has nothing in force here, `null` that it could not be checked: never turn one into the other.

export interface WeatherPlace extends GeoPoint {
  /** The property's IANA zone; forecast days are civil days in it. */
  timezone: string;
}

export interface SeaReading {
  station: string;
  temperatureC: number;
  /** Local 'yyyy-mm-ddTHH:00'. */
  measuredAt: string;
}

export interface UvReading {
  station: string;
  maxToday: number;
  /** Local 'yyyy-mm-ddTHH:00' of the maximum. */
  measuredAt: string;
}

export interface WeatherWarning {
  level: WarningLevel;
  type: WarningType;
  event: string;
  description: string;
  area: string;
  /** ISO instants. */
  onset: string;
  expires: string;
}

export interface WeatherReport {
  /** null: MET Norway unavailable now. */
  forecast: { updatedAt: string; days: ForecastDay[] } | null;
  /** null: unavailable, or no station with a reading today within range. */
  sea: SeaReading | null;
  /** null: unavailable, or no station with a reading today within range. */
  uv: UvReading | null;
  /** null: could not check; []: none in force here. */
  warnings: WeatherWarning[] | null;
  /** ISO instant the report was made. */
  fetchedAt: string;
}

export type WarningLanguage = 'hr' | 'en';

export interface WeatherSource {
  report(place: WeatherPlace, language: WarningLanguage, now: Date): Promise<WeatherReport>;
}

export interface WeatherSourceOptions {
  fetch: Egress['fetch'];
  /** MET Norway requires an identifying agent with contact details. */
  userAgent: string;
  /** For TTLs; defaults to the real clock. */
  clock?: () => Date;
}

const SEVERITY: Record<WarningLevel, number> = Object.fromEntries(
  WARNING_LEVELS.map((level, i) => [level, i]),
) as Record<WarningLevel, number>;

/** Warnings at `place` in force after `now`, in `language` (English when it has none). */
export function warningsAt(
  all: readonly CapWarning[],
  place: GeoPoint,
  language: WarningLanguage,
  now: Date,
): WeatherWarning[] | null {
  const areaIds = warningAreasAt(place);
  if (!areaIds) return null;
  const inLanguage = all.filter((w) => w.language === language);
  const chosen = inLanguage.length > 0 ? inLanguage : all.filter((w) => w.language === 'en');
  const seen = new Set<string>();
  const warnings: WeatherWarning[] = [];
  for (const w of chosen) {
    const area = w.areas.find((a) => areaIds.includes(a.id));
    if (!area || Date.parse(w.expires) <= now.getTime()) continue;
    const key = [w.event, area.id, w.onset, w.expires].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    warnings.push({
      level: w.level,
      type: w.type,
      event: w.event,
      description: w.description,
      area: area.name,
      onset: w.onset,
      expires: w.expires,
    });
  }
  return warnings.sort(
    (a, b) => a.onset.localeCompare(b.onset) || SEVERITY[b.level] - SEVERITY[a.level],
  );
}

export function createWeatherSource(options: WeatherSourceOptions): WeatherSource {
  const clock = options.clock ?? (() => new Date());
  const cache = createFeedCache({ fetch: options.fetch, userAgent: options.userAgent, clock });

  async function forecast(place: WeatherPlace) {
    const body = await cache.get(metnoUrl(place), FEED_POLICIES.metno);
    const { updatedAt, steps } = parseLocationforecast(JSON.parse(body));
    return { updatedAt, days: dailyForecast(steps, place.timezone) };
  }

  const today = (place: WeatherPlace, now: Date) =>
    DateTime.fromJSDate(now, { zone: place.timezone }).toISODate();

  async function sea(place: WeatherPlace, now: Date): Promise<SeaReading | null> {
    const table = parseStationTable(
      await cache.get(DHMZ_FEEDS.sea, FEED_POLICIES.sea),
      'Temperature_mora',
    );
    // A reading from today: yesterday's table (before DHMZ's first update) does not count.
    if (table.date !== today(place, now)) return null;
    for (const station of byDistance(SEA_STATIONS, place, WEATHER_LIMITS.maxStationKm)) {
      const reading = latestReading(table, station.name);
      if (reading) {
        return {
          station: station.name,
          temperatureC: reading.value,
          measuredAt: reading.measuredAt,
        };
      }
    }
    return null;
  }

  async function uv(place: WeatherPlace, now: Date): Promise<UvReading | null> {
    const table = parseStationTable(await cache.get(DHMZ_FEEDS.uv, FEED_POLICIES.uv), 'UV_indeks');
    // "Today's" UV: yesterday's table (before DHMZ's first update) does not count.
    if (table.date !== today(place, now)) return null;
    for (const station of byDistance(UV_STATIONS, place, WEATHER_LIMITS.maxStationKm)) {
      const reading = maxReading(table, station.name);
      if (reading) {
        return { station: station.name, maxToday: reading.value, measuredAt: reading.measuredAt };
      }
    }
    return null;
  }

  async function warnings(place: WeatherPlace, language: WarningLanguage, now: Date) {
    const feeds = await Promise.all(
      DHMZ_FEEDS.warnings.map((url) => cache.get(url, FEED_POLICIES.warnings)),
    );
    return warningsAt(feeds.flatMap(parseCapWarnings), place, language, now);
  }

  return {
    async report(place, language, now) {
      const [f, s, u, w] = await Promise.allSettled([
        forecast(place),
        sea(place, now),
        uv(place, now),
        warnings(place, language, now),
      ]);
      const value = <T>(part: PromiseSettledResult<T | null>): T | null =>
        part.status === 'fulfilled' ? part.value : null;
      const report: WeatherReport = {
        forecast: value(f),
        sea: value(s),
        uv: value(u),
        warnings: value(w),
        fetchedAt: now.toISOString(),
      };
      if (!report.forecast && !report.sea && !report.uv && !report.warnings) {
        throw new WeatherUnavailableError('no weather source answered');
      }
      return report;
    },
  };
}
