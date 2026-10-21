import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm';
import type { Db, Executor } from '../db/client';
import { blockMedia } from '../db/schema/block-media';
import { infoBlocks } from '../db/schema/info-blocks';
import { blockTranslations } from '../db/schema/translations';
import { EVENTS, type JobQueue, QUEUES, uuidFrom } from '../jobs/queue';
import type { BlockRow } from '../property/effective';
import { allBlocksPublished } from '../property/go-live';
import { loadEffectiveUnit } from '../property/load';
import {
  GUEST_LANGUAGES,
  type GuestLanguage,
  type SourceLanguage,
  type TranslationError,
  type TranslationOrigin,
  type TranslationStatus,
} from '../property/vocabulary';
import { type Collected, collectTranslations } from './collect';
import type { TranslationModel } from './model';
import { type BlockText, BULLET, checkStructure } from './structure';

// The state rules of ticket 04: the one place that moves a block's translation status and its
// published revision. Every read-then-write locks the block row, which serialises the job,
// host corrections and saves.

export interface TranslationDeps {
  db: Db;
  queue: JobQueue;
  now: () => Date;
}

/** What the translate-block job needs: the shared deps plus the model. */
export type TranslationJobDeps = TranslationDeps & { model: TranslationModel };

export class TranslationRuleError extends Error {
  override name = 'TranslationRuleError';
  constructor(
    readonly code: 'invalid-input' | 'not-found' | 'stale-revision' | 'translation-not-failed',
  ) {
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

export type TranslationRunResult = 'published' | 'failed' | 'discarded';

/** The translate-block job. Never throws for model failures: they end as a visible status. */
export async function runTranslation(
  deps: TranslationJobDeps,
  { blockId, revision }: TranslationJobData,
): Promise<TranslationRunResult> {
  const { db, model } = deps;
  const [block] = await db.select().from(infoBlocks).where(eq(infoBlocks.id, blockId));
  if (!block || block.revision !== revision || block.translationStatus !== 'pending') {
    return 'discarded';
  }
  const existing = await db
    .select({
      language: blockTranslations.language,
      origin: blockTranslations.origin,
      captions: blockTranslations.captions,
    })
    .from(blockTranslations)
    .where(and(eq(blockTranslations.blockId, blockId), eq(blockTranslations.revision, revision)));
  const have = new Set(existing.map((r) => r.language));
  const need = GUEST_LANGUAGES.filter((l) => !have.has(l));

  const media = await mediaOf(db, blockId);
  // A host correction stored before the job has no captions: they are translated for it too, so
  // guests never fall back to a newer revision's source caption.
  const uncaptioned = existing
    .filter((r) => r.origin === 'host' && media.some((m) => !(m.id in r.captions)))
    .map((r) => r.language);

  // The model calls run outside any transaction: one takes up to 86 s.
  const source: BlockText = { title: block.title, body: block.body };
  const result = await collectTranslations(model, source, need, block.sourceLanguage);
  if (!result.ok) return markFailed(deps, block, result.error);
  const { sourceLanguage } = result;
  // Captions go through their own call, one bullet per item, so the frozen prompt and the
  // structure check stay unchanged; the bullet count keeps them aligned with the media.
  // The first call's detected language is authoritative.
  let captionsByLanguage: Map<GuestLanguage, string[]> | null = null;
  if (media.length > 0) {
    const captions = await collectTranslations(
      model,
      captionsText(block.title, media),
      [...need, ...uncaptioned],
      sourceLanguage,
    );
    if (!captions.ok) return markFailed(deps, block, captions.error);
    captionsByLanguage = new Map();
    for (const [language, t] of captions.collected) {
      const lines = bulletLines(t.body);
      if (lines.length === media.length) captionsByLanguage.set(language, lines);
    }
  }
  // A language is written only when both calls produced it.
  const collected = new Map<GuestLanguage, Collected & { captions: string[] }>();
  for (const [language, t] of result.collected) {
    const captions = captionsByLanguage ? captionsByLanguage.get(language) : [];
    if (captions) collected.set(language, { ...t, captions });
  }

  return db.transaction(async (tx) => {
    const current = await lockBlock(tx, blockId);
    if (!current || current.revision !== revision) return 'discarded';
    const now = deps.now();
    // A media delete does not bump the revision, so an item may have gone meanwhile.
    const still = new Set((await mediaOf(tx, blockId)).map((m) => m.id));
    const captionMap = (captions: readonly string[]) =>
      Object.fromEntries(
        media.flatMap((m, i) => (still.has(m.id) ? [[m.id, captions[i] ?? m.caption]] : [])),
      );
    if (sourceLanguage !== null && sourceLanguage !== 'other') {
      // The source slot is always the host's own text, even over a correction made before the
      // source language was known.
      const row = {
        ...source,
        captions: captionMap(media.map((m) => m.caption)),
        origin: 'source' as const,
        updatedAt: now,
      };
      await tx
        .insert(blockTranslations)
        .values({ blockId, revision, language: sourceLanguage, ...row, createdAt: now })
        .onConflictDoUpdate({
          target: [
            blockTranslations.blockId,
            blockTranslations.revision,
            blockTranslations.language,
          ],
          set: row,
        });
    }
    if (collected.size > 0) {
      await tx
        .insert(blockTranslations)
        .values(
          [...collected].map(([language, { captions, ...t }]) => ({
            blockId,
            revision,
            language,
            ...t,
            captions: captionMap(captions),
            createdAt: now,
            updatedAt: now,
          })),
        )
        // A host correction stored meanwhile keeps its text and gets the machine captions.
        .onConflictDoUpdate({
          target: [
            blockTranslations.blockId,
            blockTranslations.revision,
            blockTranslations.language,
          ],
          set: { captions: sql`excluded.captions` },
        });
    }
    for (const language of uncaptioned) {
      const captions = captionsByLanguage?.get(language);
      if (!captions || language === sourceLanguage) continue;
      await tx
        .update(blockTranslations)
        .set({ captions: captionMap(captions) })
        .where(
          and(
            eq(blockTranslations.blockId, blockId),
            eq(blockTranslations.revision, revision),
            eq(blockTranslations.language, language),
            eq(blockTranslations.origin, 'host'),
          ),
        );
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

/** The block's media in display order. All belong to revisions up to the current one. */
const mediaOf = (db: Executor, blockId: string) =>
  db
    .select({ id: blockMedia.id, caption: blockMedia.caption })
    .from(blockMedia)
    .where(eq(blockMedia.blockId, blockId))
    .orderBy(asc(blockMedia.position), asc(blockMedia.createdAt));

/** Captions are single-line: each becomes exactly one bullet. */
const captionsText = (title: string, media: readonly { caption: string }[]): BlockText => ({
  title,
  body: media.map((m) => `- ${m.caption.replace(/\s+/g, ' ').trim()}`).join('\n'),
});

const bulletLines = (body: string) =>
  body
    .split('\n')
    .filter((line) => BULLET.test(line))
    .map((line) => line.replace(/^\s*[-*+]\s+/, '').trim());

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
    if (!block) throw new TranslationRuleError('not-found');
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
    sourceLanguage: block.sourceLanguage,
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
  return allBlocksPublished(unit.blocks);
}
