import { and, eq, inArray, or } from 'drizzle-orm';
import type { Db } from '../db/client';
import { blockMedia } from '../db/schema/block-media';
import { fieldTexts, fieldTextTranslations } from '../db/schema/field-texts';
import { stays } from '../db/schema/stays';
import { blockTranslations } from '../db/schema/translations';
import type { LocalizableText } from '../property/field-texts';
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
    fieldTexts: await loadFieldTexts(db, unit.propertyId, unit.unitId, input.language),
    now: input.now,
  });
}

/** The unit's and its property's field texts, with their translations in `language`. */
async function loadFieldTexts(
  db: Db,
  propertyId: string,
  unitId: string,
  language: GuestLanguage,
): Promise<LocalizableText[]> {
  const rows = await db
    .select()
    .from(fieldTexts)
    .where(or(eq(fieldTexts.propertyId, propertyId), eq(fieldTexts.unitId, unitId)));
  if (rows.length === 0) return [];
  const translations = await db
    .select({
      fieldTextId: fieldTextTranslations.fieldTextId,
      revision: fieldTextTranslations.revision,
      language: fieldTextTranslations.language,
      text: fieldTextTranslations.text,
    })
    .from(fieldTextTranslations)
    .where(
      and(
        inArray(
          fieldTextTranslations.fieldTextId,
          rows.map((r) => r.id),
        ),
        eq(fieldTextTranslations.language, language),
      ),
    );
  return rows.map((r) => ({
    owner: r.propertyId ? 'property' : 'unit',
    kind: r.kind,
    amenity: r.amenity,
    source: r.source,
    revision: r.revision,
    translations: translations.filter((t) => t.fieldTextId === r.id),
  }));
}
