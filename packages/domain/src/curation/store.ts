import type { Executor } from '../db/client';
import { curationItems } from '../db/schema/curation';

/** What each kind carries. Only host Provider suggestions have a producer yet; 39 adds the rest. */
export type CurationPayload = {
  kind: 'host_provider_suggestion';
  name: string;
  contact: string | null;
  note: string | null;
};

export interface CurationItemInput {
  kind: CurationPayload['kind'];
  hostId?: string | null;
  destinationId?: string | null;
  payload: CurationPayload;
}

/** Puts one item on the admin curation queue, open. The seam other tickets enqueue through (39 AC 5). */
export async function enqueueCurationItem(
  tx: Executor,
  item: CurationItemInput,
  now: Date,
): Promise<{ id: string }> {
  const [row] = await tx
    .insert(curationItems)
    .values({
      kind: item.kind,
      status: 'open',
      hostId: item.hostId ?? null,
      destinationId: item.destinationId ?? null,
      payload: item.payload,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: curationItems.id });
  if (!row) throw new Error('curation item not inserted');
  return row;
}
