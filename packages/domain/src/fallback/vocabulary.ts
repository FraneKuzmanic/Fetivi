// Web fallback codes and limits. Imports nothing: the UI bundles this file through the
// `@fetivi/domain/fallback-vocabulary` subpath, and the pgEnum is built from it.

export const FALLBACK_SOURCE_KINDS = [
  'tourist_board',
  'ferry_operator',
  'weather_service',
  'venue',
] as const;
export type FallbackSourceKind = (typeof FALLBACK_SOURCE_KINDS)[number];

export interface FallbackSite {
  /** A bare registrable host; subdomains of it pass the re-check. */
  host: string;
  kind: FallbackSourceKind;
}

/**
 * The static allowlist, each checked over https on 2026-10-23. visitsplit.com (Split Tourist
 * Board) was left out: it answered 500 over https that day.
 */
export const FALLBACK_SITES: readonly FallbackSite[] = [
  { host: 'croatia.hr', kind: 'tourist_board' }, // Croatian National Tourist Board
  { host: 'dalmatia.hr', kind: 'tourist_board' }, // Split-Dalmatia County Tourist Board
  { host: 'visittrogir.hr', kind: 'tourist_board' }, // Trogir Tourist Board
  { host: 'jadrolinija.hr', kind: 'ferry_operator' },
  { host: 'krilo.hr', kind: 'ferry_operator' },
  { host: 'tp-line.hr', kind: 'ferry_operator' },
  { host: 'meteo.hr', kind: 'weather_service' }, // DHMZ
];

export const FALLBACK_OUTCOMES = ['results', 'no_results', 'rejected', 'unavailable'] as const;
export type FallbackOutcome = (typeof FALLBACK_OUTCOMES)[number];

export const FALLBACK_LIMITS = {
  keywordsMaxChars: 60,
  keywordsMaxWords: 8,
  placeMaxChars: 40,
  placeMaxWords: 4,
  minChars: 2,
  /** A longer digit run looks like a PIN, code, phone or reservation number. */
  maxDigitRun: 3,
  /** Results shown. */
  results: 5,
  /** Results asked of Brave, before the re-check drops some. */
  requestCount: 10,
  /** Brave's `q` limits. */
  braveMaxChars: 400,
  braveMaxWords: 50,
  titleMaxChars: 120,
  snippetMaxChars: 300,
  timeoutMs: 5000,
} as const;

/** Shared platforms: a catalog website on one of these is never "a venue's own site". */
export const VENUE_HOST_DENYLIST = [
  'facebook.com',
  'instagram.com',
  'tiktok.com',
  'youtube.com',
  'google.com',
  'goo.gl',
  'tripadvisor.com',
  'booking.com',
  'airbnb.com',
  'wikipedia.org',
  'wikimedia.org',
  'linktr.ee',
  'x.com',
  'twitter.com',
] as const;
