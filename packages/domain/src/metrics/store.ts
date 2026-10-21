import type { Executor } from '../db/client';
import { turnMetrics } from '../db/schema/metrics';

/** Writes the metric row of one completed guest turn. */
export async function recordTurnMetrics(
  db: Executor,
  row: typeof turnMetrics.$inferInsert,
): Promise<void> {
  await db.insert(turnMetrics).values(row);
}
