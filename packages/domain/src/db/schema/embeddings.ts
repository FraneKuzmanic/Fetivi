import {
  foreignKey,
  integer,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { catalogTranslations } from './catalog';
import { hostPlaceTranslations } from './host-places';
import { guestLanguage } from './translations';

/** A search vector of one published catalog translation (title + body), per embedding model. */
export const catalogEmbeddings = pgTable(
  'catalog_embeddings',
  {
    recordId: uuid('record_id').notNull(),
    revision: integer('revision').notNull(),
    language: guestLanguage('language').notNull(),
    /** The embedding model id, e.g. 'voyage-4'; a vector from another model is never compared. */
    model: text('model').notNull(),
    vector: real('vector').array().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.recordId, t.revision, t.language, t.model] }),
    foreignKey({
      name: 'catalog_embeddings_translation_fk',
      columns: [t.recordId, t.revision, t.language],
      foreignColumns: [
        catalogTranslations.recordId,
        catalogTranslations.revision,
        catalogTranslations.language,
      ],
    }).onDelete('cascade'),
  ],
);

/** A search vector of one published host-added place translation (name + note), per embedding model. */
export const hostPlaceEmbeddings = pgTable(
  'host_place_embeddings',
  {
    hostPlaceId: uuid('host_place_id').notNull(),
    revision: integer('revision').notNull(),
    language: guestLanguage('language').notNull(),
    /** The embedding model id, e.g. 'voyage-4'; a vector from another model is never compared. */
    model: text('model').notNull(),
    vector: real('vector').array().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.hostPlaceId, t.revision, t.language, t.model] }),
    foreignKey({
      name: 'host_place_embeddings_translation_fk',
      columns: [t.hostPlaceId, t.revision, t.language],
      foreignColumns: [
        hostPlaceTranslations.hostPlaceId,
        hostPlaceTranslations.revision,
        hostPlaceTranslations.language,
      ],
    }).onDelete('cascade'),
  ],
);
