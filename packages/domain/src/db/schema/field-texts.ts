import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { TRANSLATED_FIELD_KINDS } from '../../property/vocabulary';
import { amenity } from './amenities';
import { sourceLanguage, translationError, translationStatus } from './info-blocks';
import { properties, units } from './properties';
import { guestLanguage, translationOrigin } from './translations';

export const fieldTextKind = pgEnum('field_text_kind', TRANSLATED_FIELD_KINDS);

/**
 * The translation state of one host free-text field on a property or unit (ticket 50). Amenity
 * rows are deleted and re-inserted on every replace, so an amenity note is keyed by its amenity,
 * not by a foreign key.
 */
export const fieldTexts = pgTable(
  'field_texts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id').references(() => properties.id, { onDelete: 'cascade' }),
    unitId: uuid('unit_id').references(() => units.id, { onDelete: 'cascade' }),
    kind: fieldTextKind('kind').notNull(),
    /** Set only for kind = amenity_note. */
    amenity: amenity('amenity'),
    /** The source text the current revision was made from; equal to the column value after every save. */
    source: text('source').notNull(),
    /** +1 on every change of `source`; translations are keyed to it. */
    revision: integer('revision').notNull().default(1),
    translationStatus: translationStatus('translation_status').notNull().default('pending'),
    /** Set only when the status is failed. */
    translationError: translationError('translation_error'),
    /** Detected by the translation job for `revision`. */
    sourceLanguage: sourceLanguage('source_language'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('field_texts_owner_check', sql`num_nonnulls(${t.propertyId}, ${t.unitId}) = 1`),
    check(
      'field_texts_amenity_check',
      sql`(${t.kind} = 'amenity_note') = (${t.amenity} is not null)`,
    ),
    // amenity is null on core fields and one owner column is always null.
    unique('field_texts_owner_uq').on(t.propertyId, t.unitId, t.kind, t.amenity).nullsNotDistinct(),
    index('field_texts_unit_idx').on(t.unitId),
  ],
);

/** One guest language's text of a field, for one revision. */
export const fieldTextTranslations = pgTable(
  'field_text_translations',
  {
    fieldTextId: uuid('field_text_id')
      .notNull()
      .references(() => fieldTexts.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    language: guestLanguage('language').notNull(),
    text: text('text').notNull(),
    origin: translationOrigin('origin').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.fieldTextId, t.revision, t.language] })],
);

export type FieldTextRow = typeof fieldTexts.$inferSelect;
export type FieldTextTranslationRow = typeof fieldTextTranslations.$inferSelect;
