import { integer, pgEnum, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { GUEST_LANGUAGES, TRANSLATION_ORIGINS } from '../../property/vocabulary';
import { infoBlocks } from './info-blocks';

export const guestLanguage = pgEnum('guest_language', GUEST_LANGUAGES);
export const translationOrigin = pgEnum('translation_origin', TRANSLATION_ORIGINS);

/** One guest language's title and body of an Info block, for one source revision. */
export const blockTranslations = pgTable(
  'block_translations',
  {
    blockId: uuid('block_id')
      .notNull()
      .references(() => infoBlocks.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    language: guestLanguage('language').notNull(),
    title: text('title').notNull(),
    /** Markdown. */
    body: text('body').notNull(),
    origin: translationOrigin('origin').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.blockId, t.revision, t.language] })],
);

export type BlockTranslationRow = typeof blockTranslations.$inferSelect;
