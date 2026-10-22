import { DateTime } from 'luxon';
import { z } from 'zod';
import type { CivilDate } from '../time';
import { WeatherFeedError } from './errors';
import type { SkyCode } from './vocabulary';

// MET Norway Locationforecast 2.0 `compact`: an hourly point forecast for about 2.5 days, then
// 6-hourly steps. CC BY 4.0, credited. The parser folds the steps into civil days in the
// property's zone (22:00Z is already tomorrow in Zagreb in summer).

const ENDPOINT = 'https://api.met.no/weatherapi/locationforecast/2.0/compact';

const round = (value: number, decimals: number) => {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
};

/**
 * The forecast URL for a point. MET allows at most 4 decimals; 2 (about 1 km) is the forecast's
 * own scale, lets neighbouring properties share a cache entry and says less about the address.
 */
export function metnoUrl(point: { lat: number; lng: number }): string {
  return `${ENDPOINT}?lat=${round(point.lat, 2)}&lon=${round(point.lng, 2)}`;
}

const period = z.object({
  summary: z.object({ symbol_code: z.string() }).optional(),
  details: z.object({ precipitation_amount: z.number().optional() }).optional(),
});

const locationforecast = z.object({
  properties: z.object({
    meta: z.object({ updated_at: z.string() }),
    timeseries: z.array(
      z.object({
        time: z.string(),
        data: z.object({
          instant: z.object({
            details: z.object({
              air_temperature: z.number().optional(),
              wind_speed: z.number().optional(),
            }),
          }),
          next_1_hours: period.optional(),
          next_6_hours: period.optional(),
          next_12_hours: period.optional(),
        }),
      }),
    ),
  }),
});

type Period = z.infer<typeof period>;

export interface ForecastStep {
  /** ISO instant. */
  time: string;
  temperatureC: number | null;
  windMs: number | null;
  next1h: Period | null;
  next6h: Period | null;
  next12h: Period | null;
}

export interface ForecastDay {
  date: CivilDate;
  sky: SkyCode;
  /** MET's raw symbol for the step nearest noon, e.g. 'partlycloudy_day'. */
  symbolCode: string;
  tempMinC: number;
  tempMaxC: number;
  precipitationMm: number;
  windMaxMs: number;
  /** The steps do not cover 12:00 local: typically "today" late in the evening. */
  partial: boolean;
}

export function parseLocationforecast(json: unknown): { updatedAt: string; steps: ForecastStep[] } {
  const parsed = locationforecast.safeParse(json);
  if (!parsed.success) throw new WeatherFeedError('unexpected Locationforecast body');
  const { meta, timeseries } = parsed.data.properties;
  return {
    updatedAt: new Date(meta.updated_at).toISOString(),
    steps: timeseries.map(({ time, data }) => ({
      time: new Date(time).toISOString(),
      temperatureC: data.instant.details.air_temperature ?? null,
      windMs: data.instant.details.wind_speed ?? null,
      next1h: data.next_1_hours ?? null,
      next6h: data.next_6_hours ?? null,
      next12h: data.next_12_hours ?? null,
    })),
  };
}

/** MET symbol code ('lightrainshowers_day') → the card's sky code. */
export function skyOf(symbolCode: string): SkyCode {
  const code = symbolCode.replace(/_(day|night|polartwilight)$/, '');
  if (code.includes('thunder')) return 'thunder';
  if (code.includes('sleet')) return 'sleet';
  if (code.includes('snow')) return 'snow';
  if (code.includes('showers')) return 'showers';
  switch (code) {
    case 'clearsky':
      return 'clear';
    case 'fair':
    case 'partlycloudy':
      return 'partly_cloudy';
    case 'fog':
      return 'fog';
    case 'lightrain':
      return 'light_rain';
    case 'rain':
      return 'rain';
    case 'heavyrain':
      return 'heavy_rain';
    default:
      return 'cloudy';
  }
}

const HOUR_MS = 3_600_000;

function symbolOf(step: ForecastStep): string | null {
  return (
    step.next6h?.summary?.symbol_code ??
    step.next1h?.summary?.symbol_code ??
    step.next12h?.summary?.symbol_code ??
    null
  );
}

/**
 * Folds the steps into civil days in `zone`. Rain is summed without double counting: an hourly
 * step adds its next hour; in the 6-hourly tail a step adds its next six hours, and any step
 * those hours already cover adds nothing. A day whose steps carry no symbol at all is dropped.
 */
export function dailyForecast(steps: readonly ForecastStep[], zone: string): ForecastDay[] {
  const groups = new Map<CivilDate, { step: ForecastStep; local: DateTime; rain: number }[]>();
  let coveredUntil = Number.NEGATIVE_INFINITY;
  for (const step of [...steps].sort((a, b) => a.time.localeCompare(b.time))) {
    const at = Date.parse(step.time);
    let rain = 0;
    if (at >= coveredUntil) {
      if (step.next1h) {
        rain = step.next1h.details?.precipitation_amount ?? 0;
        coveredUntil = at + HOUR_MS;
      } else if (step.next6h) {
        rain = step.next6h.details?.precipitation_amount ?? 0;
        coveredUntil = at + 6 * HOUR_MS;
      }
    }
    const local = DateTime.fromMillis(at, { zone });
    const date = local.toISODate() as CivilDate;
    const group = groups.get(date) ?? [];
    group.push({ step, local, rain });
    groups.set(date, group);
  }

  const days: ForecastDay[] = [];
  for (const [date, group] of groups) {
    const noon = DateTime.fromISO(`${date}T12:00`, { zone });
    const withSymbol = group.filter(({ step }) => symbolOf(step) !== null);
    const nearNoon = withSymbol.reduce<(typeof group)[number] | undefined>(
      (best, entry) =>
        best === undefined ||
        Math.abs(entry.local.diff(noon).as('milliseconds')) <
          Math.abs(best.local.diff(noon).as('milliseconds'))
          ? entry
          : best,
      undefined,
    );
    if (!nearNoon) continue;
    const symbolCode = symbolOf(nearNoon.step) ?? '';
    const temps = group.map(({ step }) => step.temperatureC).filter((t): t is number => t !== null);
    const winds = group.map(({ step }) => step.windMs).filter((w): w is number => w !== null);
    const first = group[0];
    const last = group[group.length - 1];
    const lastSpan = last?.step.next1h ? 1 : last?.step.next6h ? 6 : 0;
    const coversNoon =
      first !== undefined &&
      last !== undefined &&
      first.local <= noon &&
      last.local.plus({ hours: lastSpan }) > noon;
    days.push({
      date,
      sky: skyOf(symbolCode),
      symbolCode,
      tempMinC: temps.length ? round(Math.min(...temps), 1) : 0,
      tempMaxC: temps.length ? round(Math.max(...temps), 1) : 0,
      precipitationMm: round(
        group.reduce((sum, { rain }) => sum + rain, 0),
        1,
      ),
      windMaxMs: winds.length ? round(Math.max(...winds), 1) : 0,
      partial: !coversNoon,
    });
  }
  return days;
}
