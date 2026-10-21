import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { blockMedia } from '../db/schema/block-media';
import { stays } from '../db/schema/stays';
import { blockTranslations } from '../db/schema/translations';
import { loadEffectiveUnit } from '../property/load';
import type { GuestLanguage } from '../property/vocabulary';
import { type GuestProjection, guestProjection } from './projection';

export class ProjectionRuleError extends Error {
  override name = 'ProjectionRuleError';
  constructor(readonly code: 'not-found') {
    super(code);
  }
}

/**
 * The guest projection of a Stay's unit. Computed on every call: nothing is cached, so a host
 * edit or a publication shows on the next read. The Stay must belong to the unit.
 */
export async function loadGuestProjection(
  db: Db,
  input: { unitId: string; stayId: string; language: GuestLanguage; now: Date },
): Promise<GuestProjection> {
  const [stay] = await db
    .select({
      unitId: stays.unitId,
      checkIn: stays.checkIn,
      checkout: stays.checkout,
      partySize: stays.partySize,
      arrivalReleaseAt: stays.arrivalReleaseAt,
    })
    .from(stays)
    .where(eq(stays.id, input.stayId));
  if (!stay || stay.unitId !== input.unitId) throw new ProjectionRuleError('not-found');
  const unit = await loadEffectiveUnit(db, input.unitId);
  if (!unit) throw new ProjectionRuleError('not-found');

  const published = unit.blocks.filter((b) => b.publishedRevision !== null).map((b) => b.id);
  // Rows of other revisions are dropped by guestProjection, which matches the published one.
  const translations = published.length
    ? await db
        .select({
          blockId: blockTranslations.blockId,
          revision: blockTranslations.revision,
          language: blockTranslations.language,
          title: blockTranslations.title,
          body: blockTranslations.body,
          captions: blockTranslations.captions,
        })
        .from(blockTranslations)
        .where(
          and(
            inArray(blockTranslations.blockId, published),
            eq(blockTranslations.language, input.language),
          ),
        )
    : [];

  const media = published.length
    ? await db
        .select({
          id: blockMedia.id,
          blockId: blockMedia.blockId,
          kind: blockMedia.kind,
          caption: blockMedia.caption,
          addedRevision: blockMedia.addedRevision,
          position: blockMedia.position,
          createdAt: blockMedia.createdAt,
        })
        .from(blockMedia)
        .where(inArray(blockMedia.blockId, published))
    : [];

  return guestProjection({
    unit,
    stay,
    language: input.language,
    translations,
    media,
    now: input.now,
  });
}
