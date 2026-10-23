import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { catalogRecords, placeCategory } from './catalog';
import { sourceLanguage, translationError, translationStatus } from './info-blocks';
import { properties, wgs84Point } from './properties';
import { guestLanguage, translationOrigin } from './translations';

/**
 * A host's local knowledge about one property's area (40, architecture §4.2). A row with
 * catalog_record_id is a Host pick; a row with name/place_category/location is a Host-added
 * place. A host-added place whose suggestion the admin approved gets catalog_record_id too, and
 * reads as a pick once that record is published.
 */
export const hostPlaces = pgTable(
  'host_places',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    catalogRecordId: uuid('catalog_record_id').references(() => catalogRecords.id, {
      onDelete: 'cascade',
    }),
    name: text('name'),
    placeCategory: placeCategory('place_category'),
    location: wgs84Point('location'),
    address: text('address'),
    /** Markdown-free plain text in the host's language; null on a pick without a note. */
    note: text('note'),
    /** Source revision, +1 on every edit of name or note. */
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
    index('host_places_property_idx').on(t.propertyId),
    uniqueIndex('host_places_property_record_uq').on(t.propertyId, t.catalogRecordId),
    index('host_places_location_gist').using('gist', t.location),
    check(
      'host_places_shape_check',
      sql`${t.catalogRecordId} is not null or (${t.name} is not null and ${t.placeCategory} is not null and ${t.location} is not null and ${t.note} is not null)`,
    ),
    check(
      'host_places_published_revision_check',
      sql`${t.publishedRevision} is null or ${t.publishedRevision} <= ${t.revision}`,
    ),
  ],
);

/** One guest language's name and note of a host place, for one revision. */
export const hostPlaceTranslations = pgTable(
  'host_place_translations',
  {
    hostPlaceId: uuid('host_place_id')
      .notNull()
      .references(() => hostPlaces.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    language: guestLanguage('language').notNull(),
    /** The added place's name; '' on a pick (its title is the catalog record's). */
    name: text('name').notNull(),
    note: text('note').notNull(),
    origin: translationOrigin('origin').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.hostPlaceId, t.revision, t.language] })],
);

export type HostPlaceRow = typeof hostPlaces.$inferSelect;
export type HostPlaceTranslationRow = typeof hostPlaceTranslations.$inferSelect;
