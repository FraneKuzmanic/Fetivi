import { and, eq, isNull, lt, notInArray, sql } from 'drizzle-orm';
import type { Db, Executor } from '../db/client';
import { propertyAmenities, unitAmenities } from '../db/schema/amenities';
import { type FieldTextRow, fieldTexts, fieldTextTranslations } from '../db/schema/field-texts';
import { properties, units } from '../db/schema/properties';
import { EVENTS, type JobQueue, QUEUES, uuidFrom } from '../jobs/queue';
import { collectTranslations } from '../translation/collect';
import {
  type TranslationDeps,
  type TranslationJobDeps,
  TranslationRuleError,
  type TranslationRunResult,
} from '../translation/job';
import type { BlockText } from '../translation/structure';
import type { SharedCore } from './effective';
import {
  type Amenity,
  GUEST_LANGUAGES,
  type GuestLanguage,
  TRANSLATED_CORE_FIELDS,
  type TranslatedCoreField,
  type TranslatedFieldKind,
  type TranslationError,
  type TranslationStatus,
} from './vocabulary';

// Ticket 50: a field's translation is served only when made from the current source; guests see
// the source text meanwhile. Mirrored from host places, not generalised. No corrections: the host
// edits the source (block corrections are block-shaped; these are short notes).

const CORE_FIELD_OF = Object.fromEntries(
  Object.entries(TRANSLATED_CORE_FIELDS).map(([field, kind]) => [kind, field]),
) as Record<TranslatedFieldKind, TranslatedCoreField | undefined>;

/** The English label sent as the prompt's title, for context; the translated title is dropped. */
const FIELD_LABEL: Record<TranslatedFieldKind, string> = {
  access_instructions: 'Access instructions',
  parking_notes: 'Parking',
  house_rules_notes: 'House rules',
  amenity_note: 'Amenity note',
};

const titleOf = (row: Pick<FieldTextRow, 'kind' | 'amenity'>) =>
  row.amenity ? `Note about the amenity: ${row.amenity.replace(/_/g, ' ')}` : FIELD_LABEL[row.kind];

export type FieldOwner = { propertyId: string } | { unitId: string };

const ownerWhere = (owner: FieldOwner) =>
  'propertyId' in owner
    ? eq(fieldTexts.propertyId, owner.propertyId)
    : eq(fieldTexts.unitId, owner.unitId);

const ownerOf = (row: Pick<FieldTextRow, 'propertyId' | 'unitId'>): FieldOwner =>
  row.propertyId ? { propertyId: row.propertyId } : { unitId: row.unitId as string };

export interface FieldTextTranslationJobData {
  fieldTextId: string;
  revision: number;
}

/** Enqueues the translation of `row`'s current revision inside `tx`. */
export async function enqueueFieldTextTranslation(
  tx: Executor,
  queue: JobQueue,
  row: { id: string; revision: number },
  { retry = false }: { retry?: boolean } = {},
): Promise<void> {
  const data: FieldTextTranslationJobData = { fieldTextId: row.id, revision: row.revision };
  const options = retry ? {} : { id: uuidFrom(`field-text:${row.id}:${row.revision}`) };
  await queue.send(QUEUES.translateFieldText, data, tx, options);
}

async function lockFieldText(tx: Executor, fieldTextId: string) {
  const [row] = await tx
    .select()
    .from(fieldTexts)
    .where(eq(fieldTexts.id, fieldTextId))
    .for('update');
  return row;
}

async function lockOwnedText(
  tx: Executor,
  owner: FieldOwner,
  kind: TranslatedFieldKind,
  amenity: Amenity | null,
) {
  const [row] = await tx
    .select()
    .from(fieldTexts)
    .where(
      and(
        ownerWhere(owner),
        eq(fieldTexts.kind, kind),
        amenity ? eq(fieldTexts.amenity, amenity) : isNull(fieldTexts.amenity),
      ),
    )
    .for('update');
  return row;
}

/**
 * The one write rule: brings the field text of (owner, kind, amenity) in line with `value`.
 * Runs in the transaction that writes the column, so `source` and the column cannot drift.
 * Returns whether a job was enqueued.
 */
async function upsertFieldText(
  tx: Executor,
  queue: JobQueue,
  owner: FieldOwner,
  kind: TranslatedFieldKind,
  amenity: Amenity | null,
  value: string | null,
  now: Date,
): Promise<boolean> {
  let row = await lockOwnedText(tx, owner, kind, amenity);
  if (value === null || value.trim() === '') {
    // Translations cascade; a pending job then finds nothing and is discarded.
    if (row) await tx.delete(fieldTexts).where(eq(fieldTexts.id, row.id));
    return false;
  }
  if (!row) {
    const [inserted] = await tx
      .insert(fieldTexts)
      .values({ ...owner, kind, amenity, source: value, createdAt: now, updatedAt: now })
      .onConflictDoNothing()
      .returning();
    if (inserted) {
      await enqueueFieldTextTranslation(tx, queue, inserted);
      return true;
    }
    // A concurrent save inserted it first.
    row = await lockOwnedText(tx, owner, kind, amenity);
    if (!row) return false;
  }
  if (row.source === value) return false;
  const [updated] = await tx
    .update(fieldTexts)
    .set({
      source: value,
      revision: row.revision + 1,
      translationStatus: 'pending',
      translationError: null,
      sourceLanguage: null,
      updatedAt: now,
    })
    .where(eq(fieldTexts.id, row.id))
    .returning();
  if (!updated) return false;
  // A translation of an older source can never be served, so it is not kept.
  await tx
    .delete(fieldTextTranslations)
    .where(
      and(
        eq(fieldTextTranslations.fieldTextId, row.id),
        lt(fieldTextTranslations.revision, updated.revision),
      ),
    );
  await enqueueFieldTextTranslation(tx, queue, updated);
  return true;
}

/** Syncs the owner's three translated core fields with the saved row. Returns jobs enqueued. */
export async function syncFieldTexts(
  tx: Executor,
  queue: JobQueue,
  owner: FieldOwner,
  row: Pick<SharedCore, TranslatedCoreField>,
  now: Date,
): Promise<number> {
  let queued = 0;
  for (const [field, kind] of Object.entries(TRANSLATED_CORE_FIELDS)) {
    const value = row[field as TranslatedCoreField];
    if (await upsertFieldText(tx, queue, owner, kind, null, value, now)) queued += 1;
  }
  return queued;
}

/** Syncs the owner's amenity notes with its saved amenity list. Returns jobs enqueued. */
export async function syncAmenityNoteTexts(
  tx: Executor,
  queue: JobQueue,
  owner: FieldOwner,
  list: readonly { amenity: Amenity; note: string | null }[],
  now: Date,
): Promise<number> {
  let queued = 0;
  for (const { amenity, note } of list) {
    if (await upsertFieldText(tx, queue, owner, 'amenity_note', amenity, note, now)) queued += 1;
  }
  const kept = list.filter((a) => a.note !== null && a.note.trim() !== '').map((a) => a.amenity);
  await tx
    .delete(fieldTexts)
    .where(
      and(
        ownerWhere(owner),
        eq(fieldTexts.kind, 'amenity_note'),
        kept.length > 0 ? notInArray(fieldTexts.amenity, kept) : undefined,
      ),
    );
  return queued;
}

async function countAt(tx: Executor, fieldTextId: string, revision: number) {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(fieldTextTranslations)
    .where(
      and(
        eq(fieldTextTranslations.fieldTextId, fieldTextId),
        eq(fieldTextTranslations.revision, revision),
      ),
    );
  return row?.n ?? 0;
}

/** The translate-field-text job. Never throws for model failures: they end as a status. */
export async function runFieldTextTranslation(
  deps: TranslationJobDeps,
  { fieldTextId, revision }: FieldTextTranslationJobData,
): Promise<TranslationRunResult> {
  const { db, model } = deps;
  const [row] = await db.select().from(fieldTexts).where(eq(fieldTexts.id, fieldTextId));
  if (!row || row.revision !== revision || row.translationStatus !== 'pending') {
    return 'discarded';
  }
  const existing = await db
    .select({ language: fieldTextTranslations.language })
    .from(fieldTextTranslations)
    .where(
      and(
        eq(fieldTextTranslations.fieldTextId, fieldTextId),
        eq(fieldTextTranslations.revision, revision),
      ),
    );
  const have = new Set(existing.map((r) => r.language));
  const need = GUEST_LANGUAGES.filter((l) => !have.has(l));

  // The field label is sent as the title so the prompt keeps its shape; only the body is stored.
  const source: BlockText = { title: titleOf(row), body: row.source };
  // The model call runs outside any transaction.
  const result = await collectTranslations(model, source, need, row.sourceLanguage);
  if (!result.ok) return markFailed(deps, row, result.error);
  const { sourceLanguage } = result;

  return db.transaction(async (tx) => {
    const current = await lockFieldText(tx, fieldTextId);
    if (!current || current.revision !== revision) return 'discarded';
    const now = deps.now();
    if (sourceLanguage !== null && sourceLanguage !== 'other') {
      const values = { text: row.source, origin: 'source' as const, updatedAt: now };
      await tx
        .insert(fieldTextTranslations)
        .values({ fieldTextId, revision, language: sourceLanguage, ...values, createdAt: now })
        .onConflictDoUpdate({
          target: [
            fieldTextTranslations.fieldTextId,
            fieldTextTranslations.revision,
            fieldTextTranslations.language,
          ],
          set: values,
        });
    }
    const machine = [...result.collected];
    if (machine.length > 0) {
      await tx
        .insert(fieldTextTranslations)
        .values(
          machine.map(([language, t]) => ({
            fieldTextId,
            revision,
            language,
            text: t.body,
            origin: 'machine' as const,
            createdAt: now,
            updatedAt: now,
          })),
        )
        .onConflictDoNothing();
    }
    await tx.update(fieldTexts).set({ sourceLanguage }).where(eq(fieldTexts.id, fieldTextId));
    if ((await countAt(tx, fieldTextId, revision)) === GUEST_LANGUAGES.length) {
      await tx
        .update(fieldTexts)
        .set({ translationStatus: 'published', translationError: null, updatedAt: now })
        .where(eq(fieldTexts.id, fieldTextId));
      await deps.queue.publish(EVENTS.unitProjectionInvalidated, ownerOf(current), tx);
      return 'published';
    }
    await tx
      .update(fieldTexts)
      .set({ translationStatus: 'failed', translationError: 'structure-mismatch' })
      .where(eq(fieldTexts.id, fieldTextId));
    return 'failed';
  });
}

async function markFailed(
  deps: TranslationDeps,
  row: FieldTextRow,
  error: TranslationError,
): Promise<TranslationRunResult> {
  return deps.db.transaction(async (tx) => {
    const current = await lockFieldText(tx, row.id);
    if (current?.revision !== row.revision || current.translationStatus !== 'pending') {
      return 'discarded';
    }
    await tx
      .update(fieldTexts)
      .set({ translationStatus: 'failed', translationError: error })
      .where(eq(fieldTexts.id, row.id));
    return 'failed';
  });
}

/** Moves a failed revision back to pending and sends a fresh job. */
export async function retryFieldTextTranslation(
  deps: TranslationDeps,
  fieldTextId: string,
): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const [row] = await tx
      .update(fieldTexts)
      .set({ translationStatus: 'pending', translationError: null })
      .where(and(eq(fieldTexts.id, fieldTextId), eq(fieldTexts.translationStatus, 'failed')))
      .returning();
    if (!row) throw new TranslationRuleError('translation-not-failed');
    await enqueueFieldTextTranslation(tx, deps.queue, row, { retry: true });
  });
}

/**
 * Syncs every property's and unit's field texts with its columns, one transaction per owner.
 * Idempotent: an unchanged value enqueues nothing. Returns the number of jobs enqueued.
 */
export async function backfillFieldTexts(db: Db, queue: JobQueue, now: Date): Promise<number> {
  let queued = 0;
  const propertyIds = await db.select({ id: properties.id }).from(properties);
  for (const { id } of propertyIds) {
    queued += await db.transaction(async (tx) => {
      // The lock orders this sync after any save in flight, so it reads the committed value.
      const [row] = await tx.select().from(properties).where(eq(properties.id, id)).for('update');
      if (!row) return 0;
      const owner = { propertyId: id };
      const list = await tx
        .select({ amenity: propertyAmenities.amenity, note: propertyAmenities.note })
        .from(propertyAmenities)
        .where(eq(propertyAmenities.propertyId, id));
      return (
        (await syncFieldTexts(tx, queue, owner, row, now)) +
        (await syncAmenityNoteTexts(tx, queue, owner, list, now))
      );
    });
  }
  const unitIds = await db.select({ id: units.id }).from(units);
  for (const { id } of unitIds) {
    queued += await db.transaction(async (tx) => {
      const [row] = await tx.select().from(units).where(eq(units.id, id)).for('update');
      if (!row) return 0;
      const owner = { unitId: id };
      const list = await tx
        .select({ amenity: unitAmenities.amenity, note: unitAmenities.note })
        .from(unitAmenities)
        .where(eq(unitAmenities.unitId, id));
      return (
        (await syncFieldTexts(tx, queue, owner, row, now)) +
        (await syncAmenityNoteTexts(tx, queue, owner, list, now))
      );
    });
  }
  return queued;
}

export interface FieldTranslationStatus {
  id: string;
  /** The core field, or null for an amenity note. */
  field: TranslatedCoreField | null;
  amenity: Amenity | null;
  status: TranslationStatus;
  error: TranslationError | null;
}

/** The translation status of the owner's own field texts, for the host. */
export async function fieldTranslationStatuses(
  db: Executor,
  owner: FieldOwner,
): Promise<FieldTranslationStatus[]> {
  const rows = await db.select().from(fieldTexts).where(ownerWhere(owner));
  return rows.map((r) => ({
    id: r.id,
    field: CORE_FIELD_OF[r.kind] ?? null,
    amenity: r.amenity,
    status: r.translationStatus,
    error: r.translationError,
  }));
}

/** A field text as the projection needs it: its source and the translations at hand. */
export interface LocalizableText {
  owner: 'property' | 'unit';
  kind: TranslatedFieldKind;
  amenity: Amenity | null;
  source: string;
  revision: number;
  translations: { revision: number; language: GuestLanguage; text: string }[];
}

/**
 * `value` in `language`: the translation when it was made from exactly `value` by the owner the
 * value came from, else `value` itself. A stale translation is never returned.
 */
export function localizeFieldText(
  value: string | null,
  from: 'property' | 'unit' | null,
  kind: TranslatedFieldKind,
  amenity: Amenity | null,
  texts: readonly LocalizableText[],
  language: GuestLanguage,
): string | null {
  if (value === null || from === null) return value;
  const text = texts.find(
    (t) => t.owner === from && t.kind === kind && t.amenity === amenity && t.source === value,
  );
  const translation = text?.translations.find(
    (t) => t.revision === text.revision && t.language === language,
  );
  return translation?.text ?? value;
}
