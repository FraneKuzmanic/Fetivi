// Catalog seeding's controlled lists, endpoints and thresholds (ticket 41). Imports nothing: the
// back-office SPA bundles it through `@fetivi/domain/seeding-vocabulary`, the jobs egress reads its
// hosts, and the pgEnums are built from it. Codes that mirror other vocabularies are checked in
// vocabulary.test.ts instead of imported.

/** The open-data sources seeding imports; each is an `OPEN_DATA_SOURCES` code. */
export const SEEDING_SOURCES = ['osm', 'bathing_water', 'overture'] as const;
export type SeedingSource = (typeof SEEDING_SOURCES)[number];

/** Overture's default applies when a row carries no licence of its own. */
export const SOURCE_LICENCES: Record<SeedingSource, string> = {
  osm: 'ODbL-1.0',
  bathing_water: 'CC-BY-4.0',
  overture: 'CDLA-Permissive-2.0',
};

export const SOURCE_LABELS: Record<SeedingSource, string> = {
  osm: 'OpenStreetMap',
  bathing_water: 'Bathing water (EEA)',
  overture: 'Overture Maps',
};

export const SOURCE_ATTRIBUTION: Record<SeedingSource, string> = {
  osm: '© OpenStreetMap contributors',
  bathing_water: 'EEA; bathing waters data and coordinates: member states authorities',
  overture: '© Overture Maps Foundation',
};

/** Which source's name and location a candidate shows when its rows disagree. */
export const NAME_PRECEDENCE: readonly SeedingSource[] = ['bathing_water', 'osm', 'overture'];
export const LOCATION_PRECEDENCE: readonly SeedingSource[] = NAME_PRECEDENCE;
export const CATEGORY_PRECEDENCE: readonly SeedingSource[] = ['osm', 'overture', 'bathing_water'];

export const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';
/** The service name carries the bathing season; a new season is a one-line change here. */
export const BATHING_WATER_ENDPOINT =
  'https://marine.discomap.eea.europa.eu/arcgis/rest/services/BathingWater/BathingWater_Dyna_WM_2025/MapServer/3/query';
export const OVERTURE_STAC_ROOT = 'https://stac.overturemaps.org/catalog.json';
export const SEEDING_HOSTS = [
  'overpass-api.de',
  'marine.discomap.eea.europa.eu',
  'stac.overturemaps.org',
  'overturemaps-us-west-2.s3.us-west-2.amazonaws.com',
] as const;

/** Distances in metres, scores 0..1 (see `nameSimilarity`). */
export const SEEDING_MATCH = {
  recordMaxM: 150,
  recordMinScore: 0.8,
  mergeMaxM: 100,
  mergeMinScore: 0.85,
  containedMaxM: 50,
  possibleMaxM: 250,
  possibleMinScore: 0.5,
} as const;

export const SEEDING_LIMITS = {
  rowsPerSource: 2000,
  overtureRowGroups: 40,
  overtureMinConfidence: 0.6,
  candidatesPerList: 2000,
  draftPerRequest: 200,
  importStaleMinutes: 15,
  nameMax: 200,
} as const;

export const SEEDING_CANDIDATE_STATUSES = ['new', 'ticked', 'dismissed'] as const;
export type SeedingCandidateStatus = (typeof SEEDING_CANDIDATE_STATUSES)[number];

export const SEEDING_IMPORT_STATUSES = ['running', 'done', 'failed'] as const;
export type SeedingImportStatus = (typeof SEEDING_IMPORT_STATUSES)[number];

export const SOURCE_OUTCOMES = ['ok', 'failed'] as const;
export type SourceOutcome = (typeof SOURCE_OUTCOMES)[number];

export const SOURCE_FAILURES = ['unavailable', 'unexpected-response', 'too-large'] as const;
export type SourceFailure = (typeof SOURCE_FAILURES)[number];

/** One source's outcome in an import run. */
export type SourceRunResult =
  | { outcome: 'ok'; fetched: number; kept: number; skipped: number }
  | { outcome: 'failed'; failure: SourceFailure };

/** Words dropped from a folded name before comparing (Croatian and English generic words). */
export const GENERIC_NAME_WORDS: ReadonlySet<string> = new Set([
  'plaza',
  'beach',
  'restoran',
  'restaurant',
  'konoba',
  'caffe',
  'cafe',
  'bar',
  'pub',
  'pizzeria',
  'bistro',
  'hotel',
  'the',
  'i',
  'and',
  'uvala',
  'cove',
]);

/** A `PLACE_CATEGORIES` code (this file imports nothing; the test checks membership). */
type PlaceCategoryCode =
  | 'beach'
  | 'restaurant'
  | 'cafe_bar'
  | 'sight'
  | 'nature'
  | 'activity'
  | 'shop'
  | 'nightlife';

/** OSM tag rules, first match wins, in this order. */
export const OSM_CATEGORY_RULES: readonly {
  key: string;
  values: readonly string[];
  category: PlaceCategoryCode;
}[] = [
  { key: 'amenity', values: ['restaurant', 'fast_food'], category: 'restaurant' },
  { key: 'amenity', values: ['cafe', 'bar', 'pub', 'ice_cream'], category: 'cafe_bar' },
  { key: 'amenity', values: ['nightclub'], category: 'nightlife' },
  { key: 'amenity', values: ['dive_centre', 'boat_rental'], category: 'activity' },
  { key: 'tourism', values: ['attraction', 'museum', 'viewpoint', 'gallery'], category: 'sight' },
  { key: 'tourism', values: ['theme_park'], category: 'activity' },
  {
    key: 'historic',
    values: ['castle', 'fort', 'monument', 'archaeological_site', 'ruins'],
    category: 'sight',
  },
  { key: 'natural', values: ['beach'], category: 'beach' },
  { key: 'natural', values: ['peak', 'cave_entrance'], category: 'nature' },
  { key: 'leisure', values: ['beach_resort'], category: 'beach' },
  { key: 'leisure', values: ['park', 'nature_reserve'], category: 'nature' },
  { key: 'leisure', values: ['water_park'], category: 'activity' },
  { key: 'shop', values: ['gift', 'souvenir', 'art', 'craft', 'wine', 'deli'], category: 'shop' },
];

/**
 * Whole `_`-separated words of Overture's `basic_category` (then `taxonomy.primary`), first match
 * wins. The extra words (eatery, lounge, dance_club, place_of_worship, fort, gifts) come from the
 * values in the recorded Trogir extract.
 */
export const OVERTURE_CATEGORY_KEYWORDS: readonly { match: string; category: PlaceCategoryCode }[] =
  [
    { match: 'night_club', category: 'nightlife' },
    { match: 'nightlife', category: 'nightlife' },
    { match: 'dance_club', category: 'nightlife' },
    { match: 'restaurant', category: 'restaurant' },
    { match: 'pizza', category: 'restaurant' },
    { match: 'seafood', category: 'restaurant' },
    { match: 'eatery', category: 'restaurant' },
    { match: 'cafe', category: 'cafe_bar' },
    { match: 'coffee', category: 'cafe_bar' },
    { match: 'bar', category: 'cafe_bar' },
    { match: 'pub', category: 'cafe_bar' },
    { match: 'ice_cream', category: 'cafe_bar' },
    { match: 'lounge', category: 'cafe_bar' },
    { match: 'beach', category: 'beach' },
    { match: 'museum', category: 'sight' },
    { match: 'landmark', category: 'sight' },
    { match: 'historic', category: 'sight' },
    { match: 'monument', category: 'sight' },
    { match: 'castle', category: 'sight' },
    { match: 'fort', category: 'sight' },
    { match: 'church', category: 'sight' },
    { match: 'place_of_worship', category: 'sight' },
    { match: 'gallery', category: 'sight' },
    { match: 'park', category: 'nature' },
    { match: 'nature', category: 'nature' },
    { match: 'hiking', category: 'nature' },
    { match: 'mountain', category: 'nature' },
    { match: 'tour', category: 'activity' },
    { match: 'boat', category: 'activity' },
    { match: 'diving', category: 'activity' },
    { match: 'kayak', category: 'activity' },
    { match: 'water_sport', category: 'activity' },
    { match: 'rental', category: 'activity' },
    { match: 'souvenir', category: 'shop' },
    { match: 'gift', category: 'shop' },
    { match: 'gifts', category: 'shop' },
    { match: 'wine', category: 'shop' },
    { match: 'winery', category: 'shop' },
  ];
