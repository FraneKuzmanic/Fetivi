import { and, eq, lt } from 'drizzle-orm';
import { type Db, type Executor, pgCode } from '../db/client';
import { catalogRecords } from '../db/schema/catalog';
import { allotmentSlots, type OfferRow, offers } from '../db/schema/offers';
import type { JobQueue } from '../jobs/queue';
import { enqueueOfferTranslation, lockOfferRow } from './translation';

// The one write path for Offers. A new revision of the title, description or policy text
// enqueues its translation in the same transaction, as for blocks and catalog records.

export type NewOffer = Omit<
  typeof offers.$inferInsert,
  | 'id'
  | 'revision'
  | 'publishedRevision'
  | 'translationStatus'
  | 'translationError'
  | 'sourceLanguage'
  | 'createdAt'
  | 'updatedAt'
>;
/** Owner and destination never change, which also keeps slot times valid. */
export type OfferChanges = Partial<Omit<NewOffer, 'providerId' | 'hostId' | 'destinationId'>>;

export class OfferRuleError extends Error {
  override name = 'OfferRuleError';
  constructor(readonly code: 'not-found' | 'invalid-input' | 'offer-has-slots' | 'seats-taken') {
    super(code);
  }
}

/** A violated CHECK (23514) or an unknown foreign key (23503) is invalid input. */
export async function withOfferChecks<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const code = pgCode(error);
    if (code === '23514' || code === '23503') throw new OfferRuleError('invalid-input');
    throw error;
  }
}

export async function lockOffer(tx: Executor, id: string): Promise<OfferRow> {
  const offer = await lockOfferRow(tx, id);
  if (!offer) throw new OfferRuleError('not-found');
  return offer;
}

/** A linked place must be a catalog place in the Offer's destination. */
async function assertPlace(
  tx: Executor,
  placeId: string | null | undefined,
  destinationId: string | null | undefined,
): Promise<void> {
  if (placeId == null) return;
  if (destinationId == null) throw new OfferRuleError('invalid-input');
  const [record] = await tx
    .select({ kind: catalogRecords.kind, destinationId: catalogRecords.destinationId })
    .from(catalogRecords)
    .where(eq(catalogRecords.id, placeId));
  if (record?.kind !== 'place' || record.destinationId !== destinationId) {
    throw new OfferRuleError('invalid-input');
  }
}

/** Inserts an Offer at revision 1 and enqueues its translation in the same transaction. */
export async function createOffer(
  db: Db,
  queue: JobQueue,
  values: NewOffer,
  now: Date,
): Promise<OfferRow> {
  return withOfferChecks(() =>
    db.transaction(async (tx) => {
      await assertPlace(tx, values.placeId, values.destinationId);
      const [offer] = await tx
        .insert(offers)
        .values({ ...values, createdAt: now, updatedAt: now })
        .returning();
      if (!offer) throw new Error('offer insert returned nothing');
      await enqueueOfferTranslation(tx, queue, offer);
      return offer;
    }),
  );
}

/** Updates an Offer; a changed title, description or policy text adds a revision and enqueues it. */
export async function updateOffer(
  db: Db,
  queue: JobQueue,
  id: string,
  changes: OfferChanges,
  now: Date,
): Promise<OfferRow> {
  return withOfferChecks(() =>
    db.transaction(async (tx) => {
      const current = await lockOffer(tx, id);
      if (changes.placeId !== undefined) {
        await assertPlace(tx, changes.placeId, current.destinationId);
      }
      if (changes.availabilityMode !== undefined && changes.availabilityMode !== 'allotment') {
        const [slot] = await tx
          .select({ id: allotmentSlots.id })
          .from(allotmentSlots)
          .where(eq(allotmentSlots.offerId, id))
          .limit(1);
        if (slot) throw new OfferRuleError('offer-has-slots');
      }
      // The editor sends whole sections, so compare values, not presence.
      const textChanged =
        (changes.title !== undefined && changes.title !== current.title) ||
        (changes.description !== undefined && changes.description !== current.description) ||
        (changes.cancellationPolicy !== undefined &&
          changes.cancellationPolicy !== current.cancellationPolicy);
      const [offer] = await tx
        .update(offers)
        .set({
          ...changes,
          updatedAt: now,
          ...(textChanged
            ? {
                revision: current.revision + 1,
                translationStatus: 'pending' as const,
                translationError: null,
                sourceLanguage: null,
              }
            : {}),
        })
        .where(eq(offers.id, id))
        .returning();
      if (!offer) throw new OfferRuleError('not-found');
      if (textChanged) await enqueueOfferTranslation(tx, queue, offer);
      return offer;
    }),
  );
}

/** Deletes an Offer and its slots, unless some slot has seats taken. */
export async function deleteOffer(db: Db, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    await lockOffer(tx, id);
    const [taken] = await tx
      .select({ id: allotmentSlots.id })
      .from(allotmentSlots)
      .where(
        and(eq(allotmentSlots.offerId, id), lt(allotmentSlots.remaining, allotmentSlots.capacity)),
      )
      .limit(1);
    if (taken) throw new OfferRuleError('seats-taken');
    await tx.delete(offers).where(eq(offers.id, id));
  });
}
