import { DateTime } from 'luxon';
import { type CivilDate, endOfCivilDay, startOfCivilDay } from '../time';
import type { ForecastDay } from './metno';
import type { SeaReading, UvReading, WeatherPlace, WeatherReport, WeatherWarning } from './source';
import { WARNING_LEVELS, WEATHER_CREDITS, WEATHER_LIMITS, type WeatherCredit } from './vocabulary';

// What get_weather answers: the asked day and the next two, the sea, UV and the DHMZ warnings in
// force over those days, with the credits both licences ask for. The nulls keep their meaning
// from the report: `warnings: null` is "could not check", never "none".

/** How far ahead get_weather may be asked about; MET Norway reaches about this far. */
export const WEATHER_TOOL_DAYS_AHEAD = 8;

export interface WeatherToolResult {
  /** The asked day, a civil date at the property. */
  date: CivilDate;
  timezone: string;
  /** null: forecast unavailable now; []: the asked day is past the forecast's end. */
  days: ForecastDay[] | null;
  forecastUpdatedAt: string | null;
  sea: SeaReading | null;
  uv: UvReading | null;
  /** null: could not check; []: none in force over the returned days. */
  warnings: WeatherWarning[] | null;
  credits: WeatherCredit[];
}

/** The asked day is before today or too far ahead to forecast. */
export class WeatherDateError extends Error {
  override name = 'WeatherDateError';
  constructor(readonly reason: 'past' | 'too_far') {
    super(`weather date ${reason}`);
  }
}

const shift = (date: CivilDate, days: number, zone: string) =>
  DateTime.fromISO(date, { zone }).plus({ days }).toISODate() as CivilDate;

/** The day get_weather answers for: `asked`, default today at the place; checked against the range. */
export function weatherToolDate(
  place: WeatherPlace,
  asked: CivilDate | undefined,
  now: Date,
): CivilDate {
  const today = DateTime.fromJSDate(now, { zone: place.timezone }).toISODate() as CivilDate;
  const date = asked ?? today;
  if (date < today) throw new WeatherDateError('past');
  if (date > shift(today, WEATHER_TOOL_DAYS_AHEAD, place.timezone)) {
    throw new WeatherDateError('too_far');
  }
  return date;
}

/** At most WEATHER_LIMITS.maxWarnings, keeping the most severe, in their original order. */
function capWarnings(warnings: WeatherWarning[]): WeatherWarning[] {
  if (warnings.length <= WEATHER_LIMITS.maxWarnings) return warnings;
  const severity = (w: WeatherWarning) => WARNING_LEVELS.indexOf(w.level);
  const kept = new Set(
    [...warnings].sort((a, b) => severity(b) - severity(a)).slice(0, WEATHER_LIMITS.maxWarnings),
  );
  return warnings.filter((w) => kept.has(w));
}

/** The report narrowed to `date` and the next days (WEATHER_LIMITS.toolDays in all). */
export function weatherToolResult(
  report: WeatherReport,
  place: WeatherPlace,
  date: CivilDate,
  now: Date,
): WeatherToolResult {
  // In force over the returned days: not over before the asked day starts, nor before now.
  const from = Math.max(now.getTime(), startOfCivilDay(date, place.timezone).getTime());
  const until = endOfCivilDay(
    shift(date, WEATHER_LIMITS.toolDays - 1, place.timezone),
    place.timezone,
  );
  return {
    date,
    timezone: place.timezone,
    days: report.forecast
      ? report.forecast.days.filter((d) => d.date >= date).slice(0, WEATHER_LIMITS.toolDays)
      : null,
    forecastUpdatedAt: report.forecast?.updatedAt ?? null,
    sea: report.sea,
    uv: report.uv,
    warnings: report.warnings
      ? capWarnings(
          report.warnings.filter(
            (w) => Date.parse(w.expires) > from && Date.parse(w.onset) < until.getTime(),
          ),
        )
      : null,
    credits: [...WEATHER_CREDITS],
  };
}
