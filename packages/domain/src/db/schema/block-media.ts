import { sql } from 'drizzle-orm';
import { check, index, integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { MEDIA_KINDS } from '../../property/vocabulary';
import { infoBlocks } from './info-blocks';

export const mediaKind = pgEnum('media_kind', MEDIA_KINDS);

/** A photo or short video on an Info block. The bytes live in the MediaStore as `<id>.<ext>`. */
export const blockMedia = pgTable(
  'block_media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    blockId: uuid('block_id')
      .notNull()
      .references(() => infoBlocks.id, { onDelete: 'cascade' }),
    kind: mediaKind('kind').notNull(),
    /** Sniffed from the bytes, one of MEDIA_CONTENT_TYPES. */
    contentType: text('content_type').notNull(),
    bytes: integer('bytes').notNull(),
    /** Source-language caption; also the alt text. */
    caption: text('caption').notNull(),
    /** The block revision that introduced this item; guests see it from that revision's publication. */
    addedRevision: integer('added_revision').notNull(),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('block_media_block_idx').on(t.blockId),
    check(
      'block_media_content_type_check',
      sql`${t.contentType} in ('image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm')`,
    ),
  ],
);

export type BlockMediaRow = typeof blockMedia.$inferSelect;
