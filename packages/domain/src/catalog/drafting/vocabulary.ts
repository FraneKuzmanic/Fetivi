// Catalog drafting codes and limits (ticket 42). Imports nothing: the pgEnums are built from it and
// the web bundles it through the `@fetivi/domain/drafting-vocabulary` subpath.

/** Architecture §4.1's drafting model. */
export const DRAFTING_MODEL_ID = 'claude-haiku-5-5';

export const DRAFTING_RUN_KINDS = ['draft', 'refresh'] as const;
export type DraftingRunKind = (typeof DRAFTING_RUN_KINDS)[number];

/**
 * `diffed`: a refresh found changes and queued an item. `unchanged`: a refresh found nothing.
 * `no_sources`: there is no allowed URL, or no page gave usable text.
 */
export const DRAFTING_TASK_STATUSES = [
  'queued',
  'drafted',
  'diffed',
  'unchanged',
  'no_sources',
  'failed',
] as const;
export type DraftingTaskStatus = (typeof DRAFTING_TASK_STATUSES)[number];

export const DRAFTING_FAILURES = [
  'fetch-failed',
  'model-error',
  'not-configured',
  'record-gone',
] as const;
export type DraftingFailure = (typeof DRAFTING_FAILURES)[number];

export const DRAFTING_LIMITS = {
  /** AC 6's spend guard: about 25 × at most 60k input characters to Haiku per run. */
  recordsPerRun: 25,
  pagesPerTask: 5,
  linkedPagesPerSite: 3,
  bytesPerPage: 2_000_000,
  charsPerPage: 15_000,
  charsPerTask: 50_000,
  minUsefulChars: 200,
  fetchTimeoutMs: 10_000,
  maxOutputTokens: 4000,
  titleMax: 120,
  descriptionMax: 1200,
  addressMax: 200,
  phoneMax: 40,
  /** CATALOG_LIMITS.hoursPerRecord; written as a literal because this file imports nothing. */
  hoursMax: 50,
  seasonsMax: 12,
  refreshCooldownDays: 30,
  /**
   * A task still queued after this long lost its job (a crash past the job's 300 s expiry, with
   * no retry), so it counts as failed and no longer blocks the next run.
   */
  taskStaleMinutes: 30,
} as const;

/** Path or anchor-text keywords of the linked pages worth following on a venue site. */
export const LINK_KEYWORDS = [
  'kontakt',
  'contact',
  'o-nama',
  'about',
  'radno-vrijeme',
  'hours',
  'opening',
  'menu',
  'jelovnik',
  'info',
  'location',
  'lokacija',
] as const;

/** Social hosts a venue may own a page on, allowed as sources. */
export const SOCIAL_HOSTS = ['facebook.com', 'instagram.com'] as const;

export const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
export const COMMONS_HOST = 'commons.wikimedia.org';

/** The factual fields a pre-season refresh compares; descriptions and images are never re-drafted. */
export const REFRESH_FIELDS = [
  'title',
  'address',
  'phone',
  'websiteUrl',
  'openingHours',
  'seasons',
] as const;
export type RefreshField = (typeof REFRESH_FIELDS)[number];
