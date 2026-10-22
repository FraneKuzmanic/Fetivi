// Test-only weather: a fixed report, an always-down source, and a fetch that serves the recorded
// DHMZ and MET Norway responses (`weather/recorded/`), so no test reaches the network.
import { readFileSync } from 'node:fs';
import type { Egress } from '@fetivi/egress';
import { DateTime } from 'luxon';
import type { CivilDate } from '../time';
import { DHMZ_FEEDS } from '../weather/dhmz';
import { WeatherUnavailableError } from '../weather/errors';
import type { WeatherReport, WeatherSource } from '../weather/source';

const ZONE = 'Europe/Zagreb';

/** When the files in `weather/recorded/` were fetched; pin the clock here. */
export const WEATHER_RECORDED_AT = new Date('2026-10-22T20:28:08Z');

/**
 * Three forecast days from `today`, Split sea 23.4 °C, UV 7.1, and one yellow wind warning for
 * Middle Dalmatia from 16:00 to midnight today (Zagreb time).
 */
export function sampleWeatherReport(today: CivilDate): WeatherReport {
  const day = (offset: number) =>
    DateTime.fromISO(today, { zone: ZONE }).plus({ days: offset }).toISODate() as CivilDate;
  const at = (time: string) => DateTime.fromISO(`${today}T${time}`, { zone: ZONE });
  return {
    forecast: {
      updatedAt: at('06:00').toUTC().toISO() as string,
      days: [
        {
          date: day(0),
          sky: 'partly_cloudy',
          symbolCode: 'partlycloudy_day',
          tempMinC: 21.2,
          tempMaxC: 29.4,
          precipitationMm: 0,
          windMaxMs: 7.6,
          partial: false,
        },
        {
          date: day(1),
          sky: 'showers',
          symbolCode: 'rainshowers_day',
          tempMinC: 20.1,
          tempMaxC: 26.8,
          precipitationMm: 4.2,
          windMaxMs: 5.1,
          partial: false,
        },
        {
          date: day(2),
          sky: 'clear',
          symbolCode: 'clearsky_day',
          tempMinC: 22,
          tempMaxC: 30.3,
          precipitationMm: 0,
          windMaxMs: 3.4,
          partial: false,
        },
      ],
    },
    sea: { station: 'Split', temperatureC: 23.4, measuredAt: `${today}T14:00` },
    uv: { station: 'Split', maxToday: 7.1, measuredAt: `${today}T13:00` },
    warnings: [
      {
        level: 'yellow',
        type: 'wind',
        event: 'Yellow wind warning',
        description: 'Strong bura with gale-force gusts on the coast and islands.',
        area: 'Middle Dalmatia region',
        onset: at('16:00').toUTC().toISO() as string,
        expires: at('23:59:59').toUTC().toISO() as string,
      },
    ],
    fetchedAt: at('12:00').toUTC().toISO() as string,
  };
}

/** A source that always answers `report`, or what `report(now)` builds. */
export function fixedWeatherSource(
  report: WeatherReport | ((now: Date) => WeatherReport),
): WeatherSource & { readonly calls: number } {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async report(_place, _language, now) {
      calls++;
      return typeof report === 'function' ? report(now) : report;
    },
  };
}

/** A source whose every upstream is down. */
export function unavailableWeatherSource(): WeatherSource {
  return {
    async report() {
      throw new WeatherUnavailableError('no weather source answered');
    },
  };
}

const recordedFile = (name: string) =>
  readFileSync(new URL(`../weather/recorded/${name}`, import.meta.url), 'utf8');

const METNO_PREFIX = 'https://api.met.no/weatherapi/locationforecast/2.0/compact?';

export interface RecordedWeatherFetchOptions {
  /** URLs (or prefixes) that answer 503, to take a source down. */
  down?: readonly string[];
  /** Replacement bodies by exact URL. */
  bodies?: Readonly<Record<string, string>>;
}

/**
 * A fetch serving the recorded feeds by URL. Any Locationforecast point gets the Trogir
 * recording. Anything else is a 404.
 */
export function recordedWeatherFetch(options: RecordedWeatherFetchOptions = {}): Egress['fetch'] & {
  readonly urls: string[];
} {
  const urls: string[] = [];
  const files: Record<string, string> = {
    [DHMZ_FEEDS.sea]: 'more_n.xml',
    [DHMZ_FEEDS.uv]: 'uvi.xml',
    [DHMZ_FEEDS.warnings[0]]: 'cap_hr_today.xml',
    [DHMZ_FEEDS.warnings[1]]: 'cap_hr_tomorrow.xml',
    [DHMZ_FEEDS.warnings[2]]: 'cap_hr_day_after_tomorrow.xml',
  };
  const fetch = async (input: string | URL) => {
    const url = String(input);
    urls.push(url);
    if (options.down?.some((prefix) => url.startsWith(prefix))) {
      return new Response('down', { status: 503 });
    }
    const replaced = options.bodies?.[url];
    if (replaced !== undefined) return new Response(replaced);
    if (url.startsWith(METNO_PREFIX)) {
      return new Response(recordedFile('metno-trogir.json'), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const file = files[url];
    return file ? new Response(recordedFile(file)) : new Response('not found', { status: 404 });
  };
  return Object.assign(fetch, { urls });
}
