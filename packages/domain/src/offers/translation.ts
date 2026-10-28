import { and, eq, lt, sql } from 'drizzle-orm';
import type { Executor } from '../db/client';
import { type OfferRow, offers, offerTranslations } from '../db/schema/offers';
import { type JobQueue, QUEUES, uuidFrom } from '../jobs/queue';
import {
  GUEST_LANGUAGES,
  type GuestLanguage,
  type SourceLanguage,
  type TranslationError,
  type TranslationOrigin,
  type TranslationStatus,
} from '../property/vocabulary';
import { collectTranslations } from '../translation/collect';
import {
  type TranslationDeps,
  type TranslationJobDeps,
  TranslationRuleError,
  type TranslationRunResult,
} from '../translation/job';
import type { BlockText } from '../translation/structure';

// The Offer twin of the catalog translation rules (ticket 05): an Offer's title, description and
// cancellation policy text are translated at save time, and guests see `published_revision`,
// which moves only when all seven languages exist for a newer revision. Mirrored rather than
// generalised: see plan 06's NOTES. No corrections: the admin edits the source.

export interface OfferTranslationJobData {
  offerId: string;
  revision: number;
}

/** Enqueues the translation of `offer`'s current revision inside `tx`. */
export async function enqueueOfferTranslation(
  tx: Executor,
  queue: JobQueue,
  offer: { id: string; revision: number },
  { retry = false }: { retry?: boolean } = {},
): Promise<void> {
  const data: OfferTranslationJobData = { offerId: offer.id, revision: offer.revision };
  const options = retry ? {} : { id: uuidFrom(`offer:${offer.id}:${offer.revision}`) };
  await queue.send(QUEUES.translateOffer, data, tx, options);
}

/** Reads an Offer with a row lock, which serialises saves, slot writes and the job. */
export async function lockOfferRow(tx: Executor, offerId: string) {
  const [offer] = await tx.select().from(offers).where(eq(offers.id, offerId)).for('update');
  return offer;
}

async function countAt(tx: Executor, offerId: string, revision: number) {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(offerTranslations)
    .where(and(eq(offerTranslations.offerId, offerId), eq(offerTranslations.revision, revision)));
  return row?.n ?? 0;
}

/**
 * The policy text goes through its own model call so the frozen prompt and structure check stay
 * unchanged. It carries the title only so the prompt has its usual shape; that title is dropped.
 */
const mainText = (offer: OfferRow): BlockText => ({ title: offer.title, body: offer.description });
const policyText = (offer: OfferRow): BlockText => ({
  title: offer.title,
  body: offer.cancellationPolicy,
});

/** The translate-offer job. Never throws for model failures: they end as a status. */
export async function runOfferTranslation(
  deps: TranslationJobDeps,
  { offerId, revision }: OfferTranslationJobData,
): Promise<TranslationRunResult> {
  const { db, model } = deps;
  const [offer] = await db.select().from(offers).where(eq(offers.id, offerId));
  if (!offer || offer.revision !== revision || offer.translationStatus !== 'pending') {
    return 'discarded';
  }
  const existing = await db
    .select({ language: offerTranslations.language })
    .from(offerTranslations)
    .where(and(eq(offerTranslations.offerId, offerId), eq(offerTranslations.revision, revision)));
  const have = new Set(existing.map((r) => r.language));
  const need = GUEST_LANGUAGES.filter((l) => !have.has(l));

  // The model calls run outside any transaction.
  const main = mainText(offer);
  const a = await collectTranslations(model, main, need, offer.sourceLanguage);
  if (!a.ok) return markFailed(deps, offer, a.error);
  // The first call's detected language is authoritative.
  const sourceLanguage = a.sourceLanguage;
  const b = await collectTranslations(model, policyText(offer), need, sourceLanguage);
  if (!b.ok) return markFailed(deps, offer, b.error);

  const rows: { language: GuestLanguage; title: string; body: string; policy: string }[] = [];
  for (const [language, t] of a.collected) {
    const p = b.collected.get(language);
    if (p) rows.push({ language, title: t.title, body: t.body, policy: p.body });
  }

  return db.transaction(async (tx) => {
    const current = await lockOfferRow(tx, offerId);
    if (!current || current.revision !== revision) return 'discarded';
    const now = deps.now();
    if (sourceLanguage !== null && sourceLanguage !== 'other') {
      const row = {
        title: a.sourceTitle ?? offer.title,
        body: offer.description,
        cancellationPolicy: offer.cancellationPolicy,
        origin: 'source' as const,
        updatedAt: now,
      };
      await tx
        .insert(offerTranslations)
        .values({ offerId, revision, language: sourceLanguage, ...row, createdAt: now })
        .onConflictDoUpdate({
          target: [
            offerTranslations.offerId,
            offerTranslations.revision,
            offerTranslations.language,
          ],
          set: row,
        });
    }
    if (rows.length > 0) {
      await tx
        .insert(offerTranslations)
        .values(
          rows.map((r) => ({
            offerId,
            revision,
            language: r.language,
            title: r.title,
            body: r.body,
            cancellationPolicy: r.policy,
            origin: 'machine' as const,
            createdAt: now,
            updatedAt: now,
          })),
        )
        .onConflictDoNothing();
    }
    await tx.update(offers).set({ sourceLanguage }).where(eq(offers.id, offerId));
    if ((await countAt(tx, offerId, revision)) === GUEST_LANGUAGES.length) {
      if (current.publishedRevision !== revision) {
        await tx
          .update(offers)
          .set({
            publishedRevision: revision,
            translationStatus: 'published',
            translationError: null,
            updatedAt: now,
          })
          .where(eq(offers.id, offerId));
        await tx
          .delete(offerTranslations)
          .where(
            and(eq(offerTranslations.offerId, offerId), lt(offerTranslations.revision, revision)),
          );
      }
      return 'published';
    }
    await tx
      .update(offers)
      .set({ translationStatus: 'failed', translationError: 'structure-mismatch' })
      .where(eq(offers.id, offerId));
    return 'failed';
  });
}

async function markFailed(
  deps: TranslationDeps,
  offer: OfferRow,
  error: TranslationError,
): Promise<TranslationRunResult> {
  return deps.db.transaction(async (tx) => {
    const current = await lockOfferRow(tx, offer.id);
    if (current?.revision !== offer.revision || current.translationStatus !== 'pending') {
      return 'discarded';
    }
    await tx
      .update(offers)
      .set({ translationStatus: 'failed', translationError: error })
      .where(eq(offers.id, offer.id));
    return 'failed';
  });
}

/** Moves a failed revision back to pending and sends a fresh job. */
export async function retryOfferTranslation(deps: TranslationDeps, offerId: string): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const [offer] = await tx
      .update(offers)
      .set({ translationStatus: 'pending', translationError: null })
      .where(and(eq(offers.id, offerId), eq(offers.translationStatus, 'failed')))
      .returning();
    if (!offer) throw new TranslationRuleError('translation-not-failed');
    await enqueueOfferTranslation(tx, deps.queue, offer, { retry: true });
  });
}

export interface OfferTranslationsView {
  offerId: string;
  /** The current source revision. */
  revision: number;
  publishedRevision: number | null;
  status: TranslationStatus;
  error: TranslationError | null;
  sourceLanguage: SourceLanguage | null;
  /** One entry per guest language, in GUEST_LANGUAGES order, at `revision`. */
  languages: {
    language: GuestLanguage;
    current: {
      title: string;
      body: string;
      cancellationPolicy: string;
      origin: TranslationOrigin;
      updatedAt: string;
    } | null;
  }[];
}

export async function listOfferTranslations(
  db: Executor,
  offer: OfferRow,
): Promise<OfferTranslationsView> {
  const rows = await db
    .select()
    .from(offerTranslations)
    .where(
      and(eq(offerTranslations.offerId, offer.id), eq(offerTranslations.revision, offer.revision)),
    );
  return {
    offerId: offer.id,
    revision: offer.revision,
    publishedRevision: offer.publishedRevision,
    status: offer.translationStatus,
    error: offer.translationError,
    sourceLanguage: offer.sourceLanguage,
    languages: GUEST_LANGUAGES.map((language) => {
      const current = rows.find((r) => r.language === language);
      return {
        language,
        current: current
          ? {
              title: current.title,
              body: current.body,
              cancellationPolicy: current.cancellationPolicy,
              origin: current.origin,
              updatedAt: current.updatedAt.toISOString(),
            }
          : null,
      };
    }),
  };
}
