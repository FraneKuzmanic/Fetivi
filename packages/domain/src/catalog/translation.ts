import { and, eq, lt, sql } from 'drizzle-orm';
import type { Executor } from '../db/client';
import { type CatalogRecordRow, catalogRecords, catalogTranslations } from '../db/schema/catalog';
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

// The catalog twin of the block translation rules (ticket 04): a record's title and description
// are translated at save time, and guests see `published_revision`, which moves only when all
// seven languages exist for a newer revision. No corrections: the admin edits the source.

export interface CatalogTranslationJobData {
  recordId: string;
  revision: number;
}

/** Enqueues the translation of `record`'s current revision inside `tx`. */
export async function enqueueCatalogTranslation(
  tx: Executor,
  queue: JobQueue,
  record: { id: string; revision: number },
  { retry = false }: { retry?: boolean } = {},
): Promise<void> {
  const data: CatalogTranslationJobData = { recordId: record.id, revision: record.revision };
  const options = retry ? {} : { id: uuidFrom(`catalog:${record.id}:${record.revision}`) };
  await queue.send(QUEUES.translateCatalogRecord, data, tx, options);
}

async function lockRecord(tx: Executor, recordId: string) {
  const [record] = await tx
    .select()
    .from(catalogRecords)
    .where(eq(catalogRecords.id, recordId))
    .for('update');
  return record;
}

async function countAt(tx: Executor, recordId: string, revision: number) {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(catalogTranslations)
    .where(
      and(eq(catalogTranslations.recordId, recordId), eq(catalogTranslations.revision, revision)),
    );
  return row?.n ?? 0;
}

const sourceText = (record: CatalogRecordRow): BlockText => ({
  title: record.title,
  body: record.description,
});

/** The translate-catalog-record job. Never throws for model failures: they end as a status. */
export async function runCatalogTranslation(
  deps: TranslationJobDeps,
  { recordId, revision }: CatalogTranslationJobData,
): Promise<TranslationRunResult> {
  const { db, model } = deps;
  const [record] = await db.select().from(catalogRecords).where(eq(catalogRecords.id, recordId));
  if (!record || record.revision !== revision || record.translationStatus !== 'pending') {
    return 'discarded';
  }
  const existing = await db
    .select({ language: catalogTranslations.language })
    .from(catalogTranslations)
    .where(
      and(eq(catalogTranslations.recordId, recordId), eq(catalogTranslations.revision, revision)),
    );
  const have = new Set(existing.map((r) => r.language));
  const need = GUEST_LANGUAGES.filter((l) => !have.has(l));

  // The model calls run outside any transaction.
  const source = sourceText(record);
  const result = await collectTranslations(model, source, need, record.sourceLanguage);
  if (!result.ok) return markFailed(deps, record, result.error);
  const { sourceLanguage, collected } = result;

  return db.transaction(async (tx) => {
    const current = await lockRecord(tx, recordId);
    if (!current || current.revision !== revision) return 'discarded';
    const now = deps.now();
    if (sourceLanguage !== null && sourceLanguage !== 'other') {
      const row = { ...source, origin: 'source' as const, updatedAt: now };
      await tx
        .insert(catalogTranslations)
        .values({ recordId, revision, language: sourceLanguage, ...row, createdAt: now })
        .onConflictDoUpdate({
          target: [
            catalogTranslations.recordId,
            catalogTranslations.revision,
            catalogTranslations.language,
          ],
          set: row,
        });
    }
    if (collected.size > 0) {
      await tx
        .insert(catalogTranslations)
        .values(
          [...collected].map(([language, t]) => ({
            recordId,
            revision,
            language,
            ...t,
            createdAt: now,
            updatedAt: now,
          })),
        )
        .onConflictDoNothing();
    }
    await tx.update(catalogRecords).set({ sourceLanguage }).where(eq(catalogRecords.id, recordId));
    if ((await countAt(tx, recordId, revision)) === GUEST_LANGUAGES.length) {
      if (current.publishedRevision !== revision) {
        await tx
          .update(catalogRecords)
          .set({
            publishedRevision: revision,
            translationStatus: 'published',
            translationError: null,
            updatedAt: now,
          })
          .where(eq(catalogRecords.id, recordId));
        await tx
          .delete(catalogTranslations)
          .where(
            and(
              eq(catalogTranslations.recordId, recordId),
              lt(catalogTranslations.revision, revision),
            ),
          );
      }
      return 'published';
    }
    await tx
      .update(catalogRecords)
      .set({ translationStatus: 'failed', translationError: 'structure-mismatch' })
      .where(eq(catalogRecords.id, recordId));
    return 'failed';
  });
}

async function markFailed(
  deps: TranslationDeps,
  record: CatalogRecordRow,
  error: TranslationError,
): Promise<TranslationRunResult> {
  return deps.db.transaction(async (tx) => {
    const current = await lockRecord(tx, record.id);
    if (current?.revision !== record.revision || current.translationStatus !== 'pending') {
      return 'discarded';
    }
    await tx
      .update(catalogRecords)
      .set({ translationStatus: 'failed', translationError: error })
      .where(eq(catalogRecords.id, record.id));
    return 'failed';
  });
}

/** Moves a failed revision back to pending and sends a fresh job. */
export async function retryCatalogTranslation(
  deps: TranslationDeps,
  recordId: string,
): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const [record] = await tx
      .update(catalogRecords)
      .set({ translationStatus: 'pending', translationError: null })
      .where(and(eq(catalogRecords.id, recordId), eq(catalogRecords.translationStatus, 'failed')))
      .returning();
    if (!record) throw new TranslationRuleError('translation-not-failed');
    await enqueueCatalogTranslation(tx, deps.queue, record, { retry: true });
  });
}

export interface CatalogTranslationsView {
  recordId: string;
  /** The current source revision. */
  revision: number;
  publishedRevision: number | null;
  status: TranslationStatus;
  error: TranslationError | null;
  sourceLanguage: SourceLanguage | null;
  /** One entry per guest language, in GUEST_LANGUAGES order, at `revision`. */
  languages: {
    language: GuestLanguage;
    current: { title: string; body: string; origin: TranslationOrigin; updatedAt: string } | null;
  }[];
}

export async function listCatalogTranslations(
  db: Executor,
  record: CatalogRecordRow,
): Promise<CatalogTranslationsView> {
  const rows = await db
    .select()
    .from(catalogTranslations)
    .where(
      and(
        eq(catalogTranslations.recordId, record.id),
        eq(catalogTranslations.revision, record.revision),
      ),
    );
  return {
    recordId: record.id,
    revision: record.revision,
    publishedRevision: record.publishedRevision,
    status: record.translationStatus,
    error: record.translationError,
    sourceLanguage: record.sourceLanguage,
    languages: GUEST_LANGUAGES.map((language) => {
      const current = rows.find((r) => r.language === language);
      return {
        language,
        current: current
          ? {
              title: current.title,
              body: current.body,
              origin: current.origin,
              updatedAt: current.updatedAt.toISOString(),
            }
          : null,
      };
    }),
  };
}
