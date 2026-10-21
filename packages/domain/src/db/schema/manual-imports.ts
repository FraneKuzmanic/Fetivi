import { jsonb, pgEnum, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { ManualDraftItem } from '../../property/manual-import/schema';
import { MANUAL_SOURCES } from '../../property/vocabulary';
import { units } from './properties';

export const manualSource = pgEnum('manual_source', MANUAL_SOURCES);

/** Drafts from a house manual, waiting for the host to confirm them one by one. */
export const manualImports = pgTable('manual_imports', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** One import per unit; a new one replaces it. */
  unitId: uuid('unit_id')
    .notNull()
    .unique()
    .references(() => units.id, { onDelete: 'cascade' }),
  source: manualSource('source').notNull(),
  /** Drafts only; the manual's text itself is not kept. Secrets in drafts are as sensitive as the typed fields. */
  items: jsonb('items').$type<ManualDraftItem[]>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export type ManualImportRow = typeof manualImports.$inferSelect;
