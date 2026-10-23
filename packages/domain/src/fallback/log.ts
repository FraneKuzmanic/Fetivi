import type { Executor } from '../db/client';
import { fallbackLog } from '../db/schema/fallback';

export type FallbackLogInsert = typeof fallbackLog.$inferInsert;

/** Writes one curation-gap row. Topic and place are normalized keywords, never guest wording. */
export async function recordFallback(db: Executor, row: FallbackLogInsert): Promise<void> {
  await db.insert(fallbackLog).values(row);
}
