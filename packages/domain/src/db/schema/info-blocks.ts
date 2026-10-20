import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { BLOCK_CATEGORIES, BLOCK_VISIBILITY } from '../../property/vocabulary';
import { properties, units } from './properties';

export const blockCategory = pgEnum('block_category', BLOCK_CATEGORIES);
export const blockVisibility = pgEnum('block_visibility', BLOCK_VISIBILITY);

/** Host-written guest information, owned by exactly one property or one unit. */
export const infoBlocks = pgTable(
  'info_blocks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id').references(() => properties.id, { onDelete: 'cascade' }),
    unitId: uuid('unit_id').references(() => units.id, { onDelete: 'cascade' }),
    category: blockCategory('category').notNull(),
    title: text('title').notNull(),
    /** Markdown, in the host's source language. */
    body: text('body').notNull(),
    visibility: blockVisibility('visibility').notNull().default('always'),
    /** Source revision, +1 on every edit; translations are keyed to it. */
    revision: integer('revision').notNull().default(1),
    /** On a unit block: the property block it stands in for on this unit. */
    replacesBlockId: uuid('replaces_block_id').references((): AnyPgColumn => infoBlocks.id, {
      onDelete: 'set null',
    }),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('info_blocks_property_idx').on(t.propertyId),
    index('info_blocks_unit_idx').on(t.unitId),
    check('info_blocks_owner_check', sql`num_nonnulls(${t.propertyId}, ${t.unitId}) = 1`),
    check(
      'info_blocks_replaces_check',
      sql`${t.replacesBlockId} is null or ${t.unitId} is not null`,
    ),
  ],
);

/** Property blocks a unit does not show. */
export const unitHiddenBlocks = pgTable(
  'unit_hidden_blocks',
  {
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' }),
    blockId: uuid('block_id')
      .notNull()
      .references(() => infoBlocks.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.unitId, t.blockId] })],
);
