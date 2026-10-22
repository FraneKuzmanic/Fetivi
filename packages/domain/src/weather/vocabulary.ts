// Weather codes and limits. Imports nothing: the UI payloads and the guest SPA bundle this file
// through the `@fetivi/domain/weather-vocabulary` subpath.

/** What the sky does on a day, folded from MET Norway's symbol codes. */
export const SKY_CODES = [
  'clear',
  'partly_cloudy',
  'cloudy',
  'fog',
  'light_rain',
  'rain',
  'heavy_rain',
  'showers',
  'thunder',
  'sleet',
  'snow',
] as const;
export type SkyCode = (typeof SKY_CODES)[number];

/** MeteoAlarm awareness levels 2, 3 and 4. Level 1 (green) is never shown. */
export const WARNING_LEVELS = ['yellow', 'orange', 'red'] as const;
export type WarningLevel = (typeof WARNING_LEVELS)[number];

/** MeteoAlarm awareness types 1 to 13, in that order. An unknown type is `other`. */
export const WARNING_TYPES = [
  'wind',
  'snow_ice',
  'thunderstorm',
  'fog',
  'high_temperature',
  'low_temperature',
  'coastal_event',
  'forest_fire',
  'avalanche',
  'rain',
  'flooding',
  'rain_flood',
  'other',
] as const;
export type WarningType = (typeof WARNING_TYPES)[number];

export const WEATHER_SOURCES = ['DHMZ', 'MET Norway'] as const;
export type WeatherSourceName = (typeof WEATHER_SOURCES)[number];

export interface WeatherCredit {
  source: WeatherSourceName;
  label: string;
  url: string;
}

/** Both licences ask only for credit: DHMZ Open Licence, MET Norway CC BY 4.0. */
export const WEATHER_CREDITS: readonly WeatherCredit[] = [
  { source: 'DHMZ', label: 'Sea, UV and warnings: DHMZ', url: 'https://meteo.hr' },
  { source: 'MET Norway', label: 'Forecast: MET Norway (CC BY 4.0)', url: 'https://www.met.no/en' },
];

export const WEATHER_LIMITS = {
  /** Forecast days a get_weather result carries: the asked day and the next two. */
  toolDays: 3,
  /** The farthest a sea or UV station may be from the property. */
  maxStationKm: 60,
  /** The farthest a warning-area reference town may be from the property. */
  maxAreaKm: 40,
} as const;
