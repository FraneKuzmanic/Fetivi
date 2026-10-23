import { and, eq, lt, sql } from 'drizzle-orm';
import type { Executor } from '../db/client';
import { catalogRecords } from '../db/schema/catalog';
import { type HostPlaceRow, hostPlaces, hostPlaceTranslations } from '../db/schema/host-places';
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

// The host place twin of the Offer translation rules (plan 06): a host-added place's name and a
// host place's note are translated at save time, and guests see `published_revision`, which
// moves only when all seven languages exist for a newer revision. Mirrored rather than
// generalised. No corrections: the host edits the source.

export interface HostPlaceTranslationJobData {
  hostPlaceId: string;
  revision: number;
}

/** A pick without a note has no text to translate; it is published at once, with no job. */
export const needsTranslation = (row: { name: string | null; note: string | null }): boolean =>
  row.note !== null || row.name !== null;

/** Enqueues the translation of `row`'s current revision inside `tx`. */
export async function enqueueHostPlaceTranslation(
  tx: Executor,
  queue: JobQueue,
  row: { id: string; revision: number },
  { retry = false }: { retry?: boolean } = {},
): Promise<void> {
  const data: HostPlaceTranslationJobData = { hostPlaceId: row.id, revision: row.revision };
  const options = retry ? {} : { id: uuidFrom(`host-place:${row.id}:${row.revision}`) };
  await queue.send(QUEUES.translateHostPlace, data, tx, options);
}

/** Reads a host place with a row lock, which serialises saves and the job. */
export async function lockHostPlaceRow(tx: Executor, hostPlaceId: string) {
  const [row] = await tx
    .select()
    .from(hostPlaces)
    .where(eq(hostPlaces.id, hostPlaceId))
    .for('update');
  return row;
}

async function countAt(tx: Executor, hostPlaceId: string, revision: number) {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(hostPlaceTranslations)
    .where(
      and(
        eq(hostPlaceTranslations.hostPlaceId, hostPlaceId),
        eq(hostPlaceTranslations.revision, revision),
      ),
    );
  return row?.n ?? 0;
}

/** The translate-host-place job. Never throws for model failures: they end as a status. */
export async function runHostPlaceTranslation(
  deps: TranslationJobDeps,
  { hostPlaceId, revision }: HostPlaceTranslationJobData,
): Promise<TranslationRunResult> {
  const { db, model } = deps;
  const [found] = await db
    .select({ row: hostPlaces, recordTitle: catalogRecords.title })
    .from(hostPlaces)
    .leftJoin(catalogRecords, eq(catalogRecords.id, hostPlaces.catalogRecordId))
    .where(eq(hostPlaces.id, hostPlaceId));
  const row = found?.row;
  if (!row || row.revision !== revision || row.translationStatus !== 'pending') {
    return 'discarded';
  }
  const existing = await db
    .select({ language: hostPlaceTranslations.language })
    .from(hostPlaceTranslations)
    .where(
      and(
        eq(hostPlaceTranslations.hostPlaceId, hostPlaceId),
        eq(hostPlaceTranslations.revision, revision),
      ),
    );
  const have = new Set(existing.map((r) => r.language));
  const need = GUEST_LANGUAGES.filter((l) => !have.has(l));

  // On a pick the title is the catalog record's source title, sent only so the prompt has its
  // usual shape, and dropped: a pick's stored name is ''.
  const isPick = row.name === null;
  const source: BlockText = { title: row.name ?? found?.recordTitle ?? '', body: row.note ?? '' };
  // The model call runs outside any transaction.
  const result = await collectTranslations(model, source, need, row.sourceLanguage);
  if (!result.ok) return markFailed(deps, row, result.error);
  const { sourceLanguage } = result;

  return db.transaction(async (tx) => {
    const current = await lockHostPlaceRow(tx, hostPlaceId);
    if (!current || current.revision !== revision) return 'discarded';
    const now = deps.now();
    if (sourceLanguage !== null && sourceLanguage !== 'other') {
      const values = {
        name: row.name ?? '',
        note: row.note ?? '',
        origin: 'source' as const,
        updatedAt: now,
      };
      await tx
        .insert(hostPlaceTranslations)
        .values({ hostPlaceId, revision, language: sourceLanguage, ...values, createdAt: now })
        .onConflictDoUpdate({
          target: [
            hostPlaceTranslations.hostPlaceId,
            hostPlaceTranslations.revision,
            hostPlaceTranslations.language,
          ],
          set: values,
        });
    }
    const machine = [...result.collected];
    if (machine.length > 0) {
      await tx
        .insert(hostPlaceTranslations)
        .values(
          machine.map(([language, t]) => ({
            hostPlaceId,
            revision,
            language,
            name: isPick ? '' : t.title,
            note: t.body,
            origin: 'machine' as const,
            createdAt: now,
            updatedAt: now,
          })),
        )
        .onConflictDoNothing();
    }
    await tx.update(hostPlaces).set({ sourceLanguage }).where(eq(hostPlaces.id, hostPlaceId));
    if ((await countAt(tx, hostPlaceId, revision)) === GUEST_LANGUAGES.length) {
      if (current.publishedRevision !== revision) {
        await tx
          .update(hostPlaces)
          .set({
            publishedRevision: revision,
            translationStatus: 'published',
            translationError: null,
            updatedAt: now,
          })
          .where(eq(hostPlaces.id, hostPlaceId));
        await tx
          .delete(hostPlaceTranslations)
          .where(
            and(
              eq(hostPlaceTranslations.hostPlaceId, hostPlaceId),
              lt(hostPlaceTranslations.revision, revision),
            ),
          );
      }
      return 'published';
    }
    await tx
      .update(hostPlaces)
      .set({ translationStatus: 'failed', translationError: 'structure-mismatch' })
      .where(eq(hostPlaces.id, hostPlaceId));
    return 'failed';
  });
}

async function markFailed(
  deps: TranslationDeps,
  row: HostPlaceRow,
  error: TranslationError,
): Promise<TranslationRunResult> {
  return deps.db.transaction(async (tx) => {
    const current = await lockHostPlaceRow(tx, row.id);
    if (current?.revision !== row.revision || current.translationStatus !== 'pending') {
      return 'discarded';
    }
    await tx
      .update(hostPlaces)
      .set({ translationStatus: 'failed', translationError: error })
      .where(eq(hostPlaces.id, row.id));
    return 'failed';
  });
}

/** Moves a failed revision back to pending and sends a fresh job. */
export async function retryHostPlaceTranslation(
  deps: TranslationDeps,
  hostPlaceId: string,
): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const [row] = await tx
      .update(hostPlaces)
      .set({ translationStatus: 'pending', translationError: null })
      .where(and(eq(hostPlaces.id, hostPlaceId), eq(hostPlaces.translationStatus, 'failed')))
      .returning();
    if (!row) throw new TranslationRuleError('translation-not-failed');
    await enqueueHostPlaceTranslation(tx, deps.queue, row, { retry: true });
  });
}

export interface HostPlaceTranslationView {
  hostPlaceId: string;
  /** The current source revision. */
  revision: number;
  publishedRevision: number | null;
  status: TranslationStatus;
  error: TranslationError | null;
  sourceLanguage: SourceLanguage | null;
  /** One entry per guest language, in GUEST_LANGUAGES order, at `revision`. */
  languages: {
    language: GuestLanguage;
    current: { name: string; note: string; origin: TranslationOrigin; updatedAt: string } | null;
  }[];
}

export async function listHostPlaceTranslations(
  db: Executor,
  row: HostPlaceRow,
): Promise<HostPlaceTranslationView> {
  const rows = await db
    .select()
    .from(hostPlaceTranslations)
    .where(
      and(
        eq(hostPlaceTranslations.hostPlaceId, row.id),
        eq(hostPlaceTranslations.revision, row.revision),
      ),
    );
  return {
    hostPlaceId: row.id,
    revision: row.revision,
    publishedRevision: row.publishedRevision,
    status: row.translationStatus,
    error: row.translationError,
    sourceLanguage: row.sourceLanguage,
    languages: GUEST_LANGUAGES.map((language) => {
      const current = rows.find((r) => r.language === language);
      return {
        language,
        current: current
          ? {
              name: current.name,
              note: current.note,
              origin: current.origin,
              updatedAt: current.updatedAt.toISOString(),
            }
          : null,
      };
    }),
  };
}
