import { eq } from 'drizzle-orm';
import type { Executor } from '../db/client';
import { curationItems } from '../db/schema/curation';
import type { CurationPayload } from './vocabulary';

export interface CurationItemInput {
  hostId?: string | null;
  destinationId?: string | null;
  recordId?: string | null;
  /** At most one item per key; a second enqueue returns the first item. */
  dedupeKey?: string | null;
  payload: CurationPayload;
}

/**
 * Puts one item on the admin curation queue, open. The seam other tickets enqueue through
 * (39 AC 5); the kind is the payload's.
 */
export async function enqueueCurationItem(
  tx: Executor,
  item: CurationItemInput,
  now: Date,
): Promise<{ id: string; created: boolean }> {
  const dedupeKey = item.dedupeKey ?? null;
  const [row] = await tx
    .insert(curationItems)
    .values({
      kind: item.payload.kind,
      status: 'open',
      hostId: item.hostId ?? null,
      destinationId: item.destinationId ?? null,
      recordId: item.recordId ?? null,
      dedupeKey,
      payload: item.payload,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: curationItems.dedupeKey })
    .returning({ id: curationItems.id });
  if (row) return { id: row.id, created: true };
  if (dedupeKey === null) throw new Error('curation item not inserted');
  const [existing] = await tx
    .select({ id: curationItems.id })
    .from(curationItems)
    .where(eq(curationItems.dedupeKey, dedupeKey));
  if (!existing) throw new Error('curation item not inserted');
  return { id: existing.id, created: false };
}
