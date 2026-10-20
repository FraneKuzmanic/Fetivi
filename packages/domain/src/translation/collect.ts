import type {
  GuestLanguage,
  SourceLanguage,
  TranslationError,
  TranslationOrigin,
} from '../property/vocabulary';
import type { TranslationModel } from './model';
import type { TranslationOutputData } from './prompt';
import { type BlockText, checkStructure } from './structure';

// The model half of a translation job, shared by blocks and catalog records: one call, the
// structure check, one retry for the languages still missing.

export interface Collected extends BlockText {
  origin: TranslationOrigin;
}

export type Collection =
  | { ok: true; sourceLanguage: SourceLanguage | null; collected: Map<GuestLanguage, Collected> }
  | { ok: false; error: TranslationError };

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

/**
 * Calls the model for the languages in `need` (one retry for those still missing) and keeps the
 * outputs that pass the structure check. `known` is the source language detected earlier, if any.
 */
export async function collectTranslations(
  model: TranslationModel,
  source: BlockText,
  need: readonly GuestLanguage[],
  known: SourceLanguage | null,
): Promise<Collection> {
  const collected = new Map<GuestLanguage, Collected>();
  if (need.length === 0) return { ok: true, sourceLanguage: known, collected };
  const first = await model.translate(source);
  if (!first.ok) return { ok: false, error: first.error };
  const sourceLanguage = first.output.source_language;
  const missing = () => need.filter((l) => l !== sourceLanguage && !collected.has(l));
  for (const [l, t] of passing(source, first.output, missing())) collected.set(l, t);
  if (missing().length > 0) {
    // One retry; only the languages still missing are taken from it.
    const second = await model.translate(source);
    if (second.ok) {
      for (const [l, t] of passing(source, second.output, missing())) collected.set(l, t);
    }
  }
  return { ok: true, sourceLanguage, collected };
}
