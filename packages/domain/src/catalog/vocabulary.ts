// Every controlled list of the destination catalog. Imports nothing: the back-office SPA bundles
// this file through the `@fetivi/domain/catalog-vocabulary` subpath, and the pgEnums are built from it.

export const CATALOG_KINDS = ['place', 'event', 'transport_note', 'day_trip'] as const;
export type CatalogKind = (typeof CATALOG_KINDS)[number];

/** Classifies places. Not the glossary's Category, which classifies Offers. */
export const PLACE_CATEGORIES = [
  'beach',
  'restaurant',
  'cafe_bar',
  'sight',
  'nature',
  'activity',
  'shop',
  'nightlife',
] as const;
export type PlaceCategory = (typeof PLACE_CATEGORIES)[number];

/** What a staleness budget is keyed by: a place's category, otherwise the record's kind. */
export type StalenessKey = PlaceCategory | Exclude<CatalogKind, 'place'>;

/** Days from verified_at until a record is past its budget; null = never stale (events expire). */
export const STALENESS_BUDGET_DAYS: Record<StalenessKey, number | null> = {
  restaurant: 90,
  cafe_bar: 90,
  shop: 90,
  activity: 90,
  nightlife: 90,
  beach: 365,
  sight: 365,
  nature: 365,
  transport_note: 180,
  day_trip: 365,
  event: null,
};

export const STALENESS_STATUSES = ['fresh', 'stale', 'never_verified', 'expired'] as const;
export type StalenessStatus = (typeof STALENESS_STATUSES)[number];

export const TRANSPORT_MODES = [
  'ferry',
  'catamaran',
  'bus',
  'boat_taxi',
  'taxi',
  'train',
  'other',
] as const;
export type TransportMode = (typeof TRANSPORT_MODES)[number];

/** The only allowed image sources (PRD §6.6). */
export const IMAGE_SOURCES = ['own_photo', 'venue_permission', 'wikimedia_commons'] as const;
export type ImageSource = (typeof IMAGE_SOURCES)[number];

export const OPEN_DATA_SOURCES = ['osm', 'bathing_water', 'overture', 'foursquare'] as const;
export type OpenDataSource = (typeof OPEN_DATA_SOURCES)[number];

/** Which kinds take season rows and opening-hours rows. */
export const KIND_HAS_SEASONS: Record<CatalogKind, boolean> = {
  place: true,
  event: false,
  transport_note: true,
  day_trip: true,
};
export const KIND_HAS_HOURS: Record<CatalogKind, boolean> = {
  place: true,
  event: false,
  transport_note: false,
  day_trip: true,
};

/** Fields a source URL can be given for, per kind; `seasons` and `openingHours` cover their rows. */
export const SOURCE_FIELDS = {
  place: [
    'title',
    'description',
    'placeCategory',
    'location',
    'address',
    'phone',
    'websiteUrl',
    'seasons',
    'openingHours',
  ],
  event: ['title', 'description', 'startsAt', 'endsAt', 'location', 'venueName', 'websiteUrl'],
  transport_note: ['title', 'description', 'transportMode', 'links', 'seasons'],
  day_trip: [
    'title',
    'description',
    'travelMinutes',
    'location',
    'websiteUrl',
    'seasons',
    'openingHours',
  ],
} as const satisfies Record<CatalogKind, readonly string[]>;
export type SourceField = (typeof SOURCE_FIELDS)[CatalogKind][number];

export const CATALOG_LIMITS = {
  radiusKmMin: 1,
  radiusKmMax: 100,
  seasonsPerRecord: 12,
  hoursPerRecord: 50,
  imagesPerPlace: 10,
  linksPerNote: 10,
  url: 2000,
  attribution: 300,
  licence: 100,
  travelMinutesMax: 1440,
} as const;
