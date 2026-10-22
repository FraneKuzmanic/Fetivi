import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  CATALOG_KINDS,
  IMAGE_SOURCES,
  OPEN_DATA_SOURCES,
  PLACE_CATEGORIES,
  type SourceField,
  TRANSPORT_MODES,
} from '../../catalog/vocabulary';
import { accounts } from './accounts';
import { sourceLanguage, translationError, translationStatus } from './info-blocks';
import { wgs84Point } from './properties';
import { guestLanguage, translationOrigin } from './translations';

export const catalogKind = pgEnum('catalog_kind', CATALOG_KINDS);
export const placeCategory = pgEnum('place_category', PLACE_CATEGORIES);
export const transportMode = pgEnum('transport_mode', TRANSPORT_MODES);
export const imageSource = pgEnum('image_source', IMAGE_SOURCES);
export const openDataSource = pgEnum('open_data_source', OPEN_DATA_SOURCES);

/** An area (a centre plus a radius) with one shared catalog. */
export const destinations = pgTable(
  'destinations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull().unique(),
    centre: wgs84Point('centre').notNull(),
    radiusM: integer('radius_m').notNull(),
    /** IANA zone; event times are entered as wall-clock times in it. */
    timezone: text('timezone').notNull().default('Europe/Zagreb'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('destinations_radius_check', sql`${t.radiusM} between 1000 and 100000`),
    index('destinations_centre_gist').using('gist', t.centre),
  ],
);

/**
 * A place, event, transport note or day trip in a destination's catalog. One table for the four
 * kinds; kind-specific columns are nullable and the CHECKs require them per kind.
 */
export const catalogRecords = pgTable(
  'catalog_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    destinationId: uuid('destination_id')
      .notNull()
      .references(() => destinations.id, { onDelete: 'restrict' }),
    kind: catalogKind('kind').notNull(),
    title: text('title').notNull(),
    /** Markdown, in the admin's source language. */
    description: text('description').notNull(),
    placeCategory: placeCategory('place_category'),
    location: wgs84Point('location'),
    address: text('address'),
    phone: text('phone'),
    websiteUrl: text('website_url'),
    venueName: text('venue_name'),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    transportMode: transportMode('transport_mode'),
    links: jsonb('links').$type<{ label: string; url: string }[]>().notNull().default([]),
    travelMinutes: smallint('travel_minutes'),
    /** Ferry and catamaran lines (FERRY_LINES ids) a visit depends on; safety alerts match on them. */
    ferryLines: text('ferry_lines').array().notNull().default(sql`'{}'::text[]`),
    /** A source URL per field, `{ fieldName: httpsUrl }`. */
    fieldSources: jsonb('field_sources')
      .$type<Partial<Record<SourceField, string>>>()
      .notNull()
      .default({}),
    /** One verification date for the whole record. */
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifiedBy: uuid('verified_by').references(() => accounts.id, { onDelete: 'set null' }),
    /** Source revision, +1 on every edit of title or description; translations are keyed to it. */
    revision: integer('revision').notNull().default(1),
    /** The revision guests see; null until all seven languages first exist. */
    publishedRevision: integer('published_revision'),
    translationStatus: translationStatus('translation_status').notNull().default('pending'),
    translationError: translationError('translation_error'),
    sourceLanguage: sourceLanguage('source_language'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('catalog_records_destination_kind_idx').on(t.destinationId, t.kind),
    index('catalog_records_location_gist').using('gist', t.location),
    check(
      'catalog_records_place_check',
      sql`((${t.kind} = 'place') = (${t.placeCategory} is not null)) and (${t.kind} <> 'place' or ${t.location} is not null)`,
    ),
    check(
      'catalog_records_event_check',
      sql`${t.kind} <> 'event' or (${t.startsAt} is not null and ${t.endsAt} is not null and ${t.endsAt} > ${t.startsAt})`,
    ),
    check(
      'catalog_records_transport_check',
      sql`(${t.kind} = 'transport_note') = (${t.transportMode} is not null)`,
    ),
    check(
      'catalog_records_day_trip_check',
      sql`${t.kind} <> 'day_trip' or ${t.travelMinutes} between 1 and 1440`,
    ),
    check(
      'catalog_records_published_revision_check',
      sql`${t.publishedRevision} is null or ${t.publishedRevision} <= ${t.revision}`,
    ),
  ],
);

/** One guest language's title and description of a catalog record, for one source revision. */
export const catalogTranslations = pgTable(
  'catalog_translations',
  {
    recordId: uuid('record_id')
      .notNull()
      .references(() => catalogRecords.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    language: guestLanguage('language').notNull(),
    title: text('title').notNull(),
    /** Markdown. */
    body: text('body').notNull(),
    origin: translationOrigin('origin').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.recordId, t.revision, t.language] })],
);

/** A recurring month-day range; it may wrap the new year (11-01 to 03-31). */
export const catalogSeasons = pgTable(
  'catalog_seasons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recordId: uuid('record_id')
      .notNull()
      .references(() => catalogRecords.id, { onDelete: 'cascade' }),
    fromMonth: smallint('from_month').notNull(),
    fromDay: smallint('from_day').notNull(),
    toMonth: smallint('to_month').notNull(),
    toDay: smallint('to_day').notNull(),
  },
  (t) => [
    index('catalog_seasons_record_idx').on(t.recordId),
    check(
      'catalog_seasons_range_check',
      sql`${t.fromMonth} between 1 and 12 and ${t.toMonth} between 1 and 12 and ${t.fromDay} between 1 and 31 and ${t.toDay} between 1 and 31`,
    ),
  ],
);

/** schema.org OpeningHoursSpecification: a close earlier than the open means past midnight. */
export const catalogOpeningHours = pgTable(
  'catalog_opening_hours',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recordId: uuid('record_id')
      .notNull()
      .references(() => catalogRecords.id, { onDelete: 'cascade' }),
    /** ISO: 1 = Monday … 7 = Sunday. */
    weekday: smallint('weekday').notNull(),
    opens: time('opens').notNull(),
    closes: time('closes').notNull(),
    validFrom: date('valid_from', { mode: 'string' }),
    validTo: date('valid_to', { mode: 'string' }),
  },
  (t) => [
    index('catalog_opening_hours_record_idx').on(t.recordId),
    check('catalog_opening_hours_weekday_check', sql`${t.weekday} between 1 and 7`),
    check(
      'catalog_opening_hours_validity_check',
      sql`${t.validFrom} is null or ${t.validTo} is null or ${t.validFrom} <= ${t.validTo}`,
    ),
    check('catalog_opening_hours_times_check', sql`${t.opens} <> ${t.closes}`),
  ],
);

/** A place photo from an allowed source, with its licence and attribution. */
export const placeImages = pgTable(
  'place_images',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recordId: uuid('record_id')
      .notNull()
      .references(() => catalogRecords.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    source: imageSource('source').notNull(),
    licence: text('licence'),
    attribution: text('attribution'),
    sourcePageUrl: text('source_page_url'),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    index('place_images_record_idx').on(t.recordId),
    check(
      'place_images_wikimedia_check',
      sql`${t.source} <> 'wikimedia_commons' or (${t.licence} is not null and ${t.attribution} is not null and ${t.sourcePageUrl} is not null)`,
    ),
    check(
      'place_images_venue_check',
      sql`${t.source} <> 'venue_permission' or ${t.attribution} is not null`,
    ),
  ],
);

/**
 * Open-data-derived fields (ODbL share-alike and others) live only here, never in
 * catalog_records' curated columns (PRD §11).
 */
export const placeOpenDataSources = pgTable(
  'place_open_data_sources',
  {
    recordId: uuid('record_id')
      .notNull()
      .references(() => catalogRecords.id, { onDelete: 'cascade' }),
    source: openDataSource('source').notNull(),
    externalId: text('external_id').notNull(),
    licence: text('licence').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.recordId, t.source] })],
);

/** How often a place was recommended, per day in the destination's zone (feeds the staleness queue). */
export const catalogRecommendations = pgTable(
  'catalog_recommendations',
  {
    recordId: uuid('record_id')
      .notNull()
      .references(() => catalogRecords.id, { onDelete: 'cascade' }),
    day: date('day', { mode: 'string' }).notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.recordId, t.day] }),
    check('catalog_recommendations_count_check', sql`${t.count} >= 0`),
  ],
);

export type DestinationRow = typeof destinations.$inferSelect;
export type CatalogRecommendationRow = typeof catalogRecommendations.$inferSelect;
export type CatalogRecordRow = typeof catalogRecords.$inferSelect;
export type CatalogTranslationRow = typeof catalogTranslations.$inferSelect;
export type CatalogSeasonRow = typeof catalogSeasons.$inferSelect;
export type CatalogOpeningHoursRow = typeof catalogOpeningHours.$inferSelect;
export type PlaceImageRow = typeof placeImages.$inferSelect;
