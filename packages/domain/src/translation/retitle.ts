import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { infoBlocks } from '../db/schema/info-blocks';
import { blockTranslations } from '../db/schema/translations';
import { GUEST_LANGUAGES, type GuestLanguage } from '../property/vocabulary';
import { sourceTitleOf } from './collect';
import { emitInvalidated, lockBlock, type TranslationJobDeps } from './job';

export interface RetitleResult {
  checked: number;
  retitled: number;
  failed: number;
}

/**
 * Ticket 56 backfill: published wizard blocks whose source slot still holds the host's title in
 * another language than the text get that slot's title translated. Only the source row's title
 * changes, at the published revision: no revision bump, nothing hidden. A retitled block no
 * longer matches the selection, so a rerun makes no model call for it.
 */
export async function retitleBlocks(deps: TranslationJobDeps): Promise<RetitleResult> {
  const { db, model } = deps;
  const candidates = await db
    .select({ block: infoBlocks })
    .from(infoBlocks)
    .innerJoin(
      blockTranslations,
      and(
        eq(blockTranslations.blockId, infoBlocks.id),
        eq(blockTranslations.revision, infoBlocks.publishedRevision),
        // Two enum types: compared as text.
        sql`${blockTranslations.language}::text = ${infoBlocks.sourceLanguage}::text`,
        eq(blockTranslations.origin, 'source'),
        eq(blockTranslations.title, infoBlocks.title),
      ),
    )
    .where(
      and(
        isNotNull(infoBlocks.wizardKey),
        eq(infoBlocks.translationStatus, 'published'),
        eq(infoBlocks.revision, infoBlocks.publishedRevision),
        inArray(infoBlocks.sourceLanguage, [...GUEST_LANGUAGES]),
      ),
    );

  const result: RetitleResult = { checked: 0, retitled: 0, failed: 0 };
  for (const { block } of candidates) {
    result.checked += 1;
    // The model call runs outside any transaction, as in the job.
    const source = { title: block.title, body: block.body };
    const answer = await model.translate(source);
    if (!answer.ok) {
      result.failed += 1;
      continue;
    }
    // The block's stored source language is authoritative, not a new detection.
    const language = block.sourceLanguage as GuestLanguage;
    const title = sourceTitleOf(source, answer.output, language);
    if (title === null) continue;
    const done = await db.transaction(async (tx) => {
      const current = await lockBlock(tx, block.id);
      if (
        !current ||
        current.revision !== block.revision ||
        current.publishedRevision !== block.publishedRevision ||
        current.title !== block.title
      ) {
        return false;
      }
      await tx
        .update(blockTranslations)
        .set({ title, updatedAt: deps.now() })
        .where(
          and(
            eq(blockTranslations.blockId, block.id),
            eq(blockTranslations.revision, block.revision),
            eq(blockTranslations.language, language),
            eq(blockTranslations.origin, 'source'),
          ),
        );
      await emitInvalidated(tx, deps.queue, current);
      return true;
    });
    if (done) result.retitled += 1;
  }
  return result;
}
