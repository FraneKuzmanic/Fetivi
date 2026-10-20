import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { infoBlocks } from '../db/schema/info-blocks';
import { blockTranslations } from '../db/schema/translations';
import { EVENTS, type Executor, type JobQueue, QUEUES, uuidFrom } from '../jobs/queue';
import type { BlockRow } from '../property/effective';
import { loadEffectiveUnit } from '../property/load';
import {
  GUEST_LANGUAGES,
  type GuestLanguage,
  type TranslationError,
  type TranslationOrigin,
  type TranslationStatus,
} from '../property/vocabulary';
import type { TranslationModel } from './model';
import type { TranslationOutputData } from './prompt';
import { type BlockText, checkStructure } from './structure';

// The state rules of ticket 04: the one place that moves a block's translation status and its
// published revision. Every read-then-write locks the block row, which serialises the job,
// host corrections and saves.

export interface TranslationDeps {
  db: Db;
  queue: JobQueue;
  now: () => Date;
}

export type SourceLanguage = GuestLanguage | 'other';

export class TranslationRuleError extends Error {
  override name = 'TranslationRuleError';
  constructor(readonly code: 'invalid-input' | 'stale-revision' | 'translation-not-failed') {
    super(code);
  }
}

export interface TranslationJobData {
  blockId: string;
  revision: number;
}

/** Enqueues the translation of `block`'s current revision inside `tx`. */
export async function enqueueTranslation(
  tx: Executor,
  queue: JobQueue,
  block: { id: string; revision: number },
  { retry = false }: { retry?: boolean } = {},
): Promise<void> {
  const data: TranslationJobData = { blockId: block.id, revision: block.revision };
  // The automatic job's id is derived from (block, revision), so a duplicate send is ignored.
  const options = retry ? {} : { id: uuidFrom(`translate:${block.id}:${block.revision}`) };
  await queue.send(QUEUES.translateBlock, data, tx, options);
}

async function lockBlock(tx: Executor, blockId: string) {
  const [block] = await tx
    .select()
    .from(infoBlocks)
    .where(eq(infoBlocks.id, blockId))
    .for('update');
  return block;
}

const projectionKey = (block: BlockRow) =>
  block.propertyId ? { propertyId: block.propertyId } : { unitId: block.unitId };

async function emitInvalidated(tx: Executor, queue: JobQueue, block: BlockRow) {
  await queue.publish(EVENTS.unitProjectionInvalidated, projectionKey(block), tx);
}

async function countAt(tx: Executor, blockId: string, revision: number) {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(blockTranslations)
    .where(and(eq(blockTranslations.blockId, blockId), eq(blockTranslations.revision, revision)));
  return row?.n ?? 0;
}

/** Makes `block`'s current revision the one guests see. */
async function publish(tx: Executor, deps: TranslationDeps, block: BlockRow) {
  await tx
    .update(infoBlocks)
    .set({
      publishedRevision: block.revision,
      translationStatus: 'published',
      translationError: null,
      updatedAt: deps.now(),
    })
    .where(eq(infoBlocks.id, block.id));
  await tx
    .delete(blockTranslations)
    .where(
      and(eq(blockTranslations.blockId, block.id), lt(blockTranslations.revision, block.revision)),
    );
  await emitInvalidated(tx, deps.queue, block);
}

interface Collected extends BlockText {
  origin: TranslationOrigin;
}

/** The slots of `output` among `wanted` that keep the source's structure. */
function passing(
  source: BlockText,
  output: TranslationOutputData,
  wanted: readonly GuestLanguage[],
): Map<GuestLanguage, Collected> {
  const found = new Map<GuestLanguage, Collected>();
  for (const language of wanted) {
    const slot = output.translations[language];
    if (checkStructure(source, slot).length === 0) {
      found.set(language, { title: slot.title, body: slot.body, origin: 'machine' });
    }
  }
  return found;
}

export type TranslationRunResult = 'published' | 'failed' | 'discarded';

/** The translate-block job. Never throws for model failures: they end as a visible status. */
export async function runTranslation(
  deps: TranslationDeps & { model: TranslationModel },
  { blockId, revision }: TranslationJobData,
): Promise<TranslationRunResult> {
  const { db, model } = deps;
  const [block] = await db.select().from(infoBlocks).where(eq(infoBlocks.id, blockId));
  if (!block || block.revision !== revision || block.translationStatus !== 'pending') {
    return 'discarded';
  }
  const existing = await db
    .select({ language: blockTranslations.language })
    .from(blockTranslations)
    .where(and(eq(blockTranslations.blockId, blockId), eq(blockTranslations.revision, revision)));
  const have = new Set(existing.map((r) => r.language));
  const need = GUEST_LANGUAGES.filter((l) => !have.has(l));

  // The model calls run outside any transaction: one takes up to 86 s.
  const source: BlockText = { title: block.title, body: block.body };
  const collected = new Map<GuestLanguage, Collected>();
  let sourceLanguage = block.sourceLanguage as SourceLanguage | null;
  if (need.length > 0) {
    const first = await model.translate(source);
    if (!first.ok) return markFailed(deps, block, first.error);
    sourceLanguage = first.output.source_language;
    if (sourceLanguage !== 'other' && need.includes(sourceLanguage)) {
      collected.set(sourceLanguage, { ...source, origin: 'source' });
    }
    const missing = () => need.filter((l) => !collected.has(l));
    for (const [l, t] of passing(source, first.output, missing())) collected.set(l, t);
    if (missing().length > 0) {
      // One retry; only the languages still missing are taken from it.
      const second = await model.translate(source);
      if (second.ok) {
        for (const [l, t] of passing(source, second.output, missing())) collected.set(l, t);
      }
    }
  }

  return db.transaction(async (tx) => {
    const current = await lockBlock(tx, blockId);
    if (!current || current.revision !== revision) return 'discarded';
    const now = deps.now();
    if (collected.size > 0) {
      await tx
        .insert(blockTranslations)
        .values(
          [...collected].map(([language, t]) => ({
            blockId,
            revision,
            language,
            ...t,
            createdAt: now,
            updatedAt: now,
          })),
        )
        // A host correction stored meanwhile wins.
        .onConflictDoNothing();
    }
    await tx.update(infoBlocks).set({ sourceLanguage }).where(eq(infoBlocks.id, blockId));
    if ((await countAt(tx, blockId, revision)) === GUEST_LANGUAGES.length) {
      if (current.publishedRevision !== revision) await publish(tx, deps, current);
      return 'published';
    }
    await tx
      .update(infoBlocks)
      .set({ translationStatus: 'failed', translationError: 'structure-mismatch' })
      .where(eq(infoBlocks.id, blockId));
    return 'failed';
  });
}

async function markFailed(
  deps: TranslationDeps,
  block: BlockRow,
  error: TranslationError,
): Promise<TranslationRunResult> {
  return deps.db.transaction(async (tx) => {
    const current = await lockBlock(tx, block.id);
    if (current?.revision !== block.revision || current.translationStatus !== 'pending') {
      return 'discarded';
    }
    await tx
      .update(infoBlocks)
      .set({ translationStatus: 'failed', translationError: error })
      .where(eq(infoBlocks.id, block.id));
    return 'failed';
  });
}

/**
 * A host's own translation of one language, for the current or the published revision. Stored even
 * when it breaks the structure; the problems come back as non-blocking warnings.
 */
export async function correctTranslation(
  deps: TranslationDeps,
  blockId: string,
  input: { language: GuestLanguage; revision: number } & BlockText,
): Promise<{ structureWarnings: string[] }> {
  const { language, revision, title, body } = input;
  return deps.db.transaction(async (tx) => {
    const block = await lockBlock(tx, blockId);
    if (!block) throw new TranslationRuleError('stale-revision');
    if (revision !== block.revision && revision !== block.publishedRevision) {
      throw new TranslationRuleError('stale-revision');
    }
    const rows = await tx
      .select()
      .from(blockTranslations)
      .where(and(eq(blockTranslations.blockId, blockId), eq(blockTranslations.revision, revision)));
    const sourceRow = rows.find((r) => r.origin === 'source');
    const isSource =
      sourceRow?.language === language ||
      (revision === block.revision && block.sourceLanguage === language);
    if (isSource) throw new TranslationRuleError('invalid-input');

    const now = deps.now();
    await tx
      .insert(blockTranslations)
      .values({
        blockId,
        revision,
        language,
        title,
        body,
        origin: 'host',
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [blockTranslations.blockId, blockTranslations.revision, blockTranslations.language],
        set: { title, body, origin: 'host', updatedAt: now },
      });

    if (revision === block.revision && block.translationStatus !== 'published') {
      if ((await countAt(tx, blockId, revision)) === GUEST_LANGUAGES.length) {
        await publish(tx, deps, block);
      }
    } else if (revision === block.publishedRevision) {
      // The text guests read changed.
      await emitInvalidated(tx, deps.queue, block);
    }

    const source: BlockText | null =
      revision === block.revision ? { title: block.title, body: block.body } : (sourceRow ?? null);
    return { structureWarnings: source ? checkStructure(source, { title, body }) : [] };
  });
}

/** Moves a failed revision back to pending and sends a fresh job. */
export async function retryTranslation(deps: TranslationDeps, blockId: string): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const [block] = await tx
      .update(infoBlocks)
      .set({ translationStatus: 'pending', translationError: null })
      .where(and(eq(infoBlocks.id, blockId), eq(infoBlocks.translationStatus, 'failed')))
      .returning();
    if (!block) throw new TranslationRuleError('translation-not-failed');
    await enqueueTranslation(tx, deps.queue, block, { retry: true });
  });
}

export interface TranslationsView {
  blockId: string;
  /** The current source revision. */
  revision: number;
  publishedRevision: number | null;
  status: TranslationStatus;
  error: TranslationError | null;
  sourceLanguage: SourceLanguage | null;
  /** One entry per guest language, in GUEST_LANGUAGES order. */
  languages: {
    language: GuestLanguage;
    /** At `revision`. */
    current: { title: string; body: string; origin: TranslationOrigin; updatedAt: string } | null;
    /** At `publishedRevision`, only when it differs from `revision`. */
    published: { title: string; body: string; origin: TranslationOrigin } | null;
  }[];
}

export async function listTranslations(db: Executor, block: BlockRow): Promise<TranslationsView> {
  const older =
    block.publishedRevision !== null && block.publishedRevision !== block.revision
      ? block.publishedRevision
      : null;
  const revisions = older === null ? [block.revision] : [block.revision, older];
  const rows = await db
    .select()
    .from(blockTranslations)
    .where(
      and(eq(blockTranslations.blockId, block.id), inArray(blockTranslations.revision, revisions)),
    );
  const at = (revision: number | null, language: GuestLanguage) =>
    rows.find((r) => r.revision === revision && r.language === language);
  return {
    blockId: block.id,
    revision: block.revision,
    publishedRevision: block.publishedRevision,
    status: block.translationStatus,
    error: block.translationError,
    sourceLanguage: block.sourceLanguage as SourceLanguage | null,
    languages: GUEST_LANGUAGES.map((language) => {
      const current = at(block.revision, language);
      const published = older === null ? undefined : at(older, language);
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
        published: published
          ? { title: published.title, body: published.body, origin: published.origin }
          : null,
      };
    }),
  };
}

/** True when guests see the current revision of every block the unit shows (go-live, ticket 20). */
export async function translationsDone(db: Db, unitId: string): Promise<boolean> {
  const unit = await loadEffectiveUnit(db, unitId);
  if (!unit) return false;
  return unit.blocks.every((b) => b.publishedRevision === b.revision);
}
