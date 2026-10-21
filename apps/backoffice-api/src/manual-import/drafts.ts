import {
  type Amenity,
  findSecretLikeText,
  IMPORTABLE_FIELD_IDS,
  type ImportableFieldId,
  LIMITS,
  type ManualDraftItem,
  type ManualExtractionData,
  SECRET_COLUMNS,
  scrubSecrets,
  scrubTexts,
  stripMarkdownHtml,
  stripMarkup,
  type WizardColumn,
  type WizardField,
  type WizardPromptKey,
  type WizardValues,
  wizardField,
} from '@fetivi/domain';
import { z } from 'zod';
import { AmenitiesBody, line, PropertyPatch, UnitPatch } from '../properties/schemas';

// Turns the model's extraction into drafts (pure). Every value goes through the validators the
// PATCH routes use; a value they reject becomes an unmapped draft, so nothing is lost silently.

type DraftInput = ManualDraftItem extends infer I
  ? I extends unknown
    ? Omit<I, 'id' | 'status'>
    : never
  : never;

const TIME_COLUMNS = new Set<WizardColumn>([
  'checkInTime',
  'checkoutTime',
  'quietHoursFrom',
  'quietHoursTo',
]);

/** The validator of one importable column: the unit's for unit and core fields, else the property's. */
export function columnSchema(field: WizardField, column: WizardColumn): z.ZodType {
  const shape: Record<string, z.ZodType> =
    field.kind === 'property' ? PropertyPatch.shape : UnitPatch.shape;
  const schema = shape[column];
  if (!schema) throw new Error(`no validator for ${column}`);
  return schema;
}

/** The validator of a whole field's values, as sent on confirm: a non-empty subset of its columns. */
export function fieldSchema(field: WizardField) {
  const shape = Object.fromEntries(
    field.columns.map((c) => [c, columnSchema(field, c).optional()]),
  );
  return z
    .strictObject(shape)
    .refine((values) => Object.values(values).some((v) => v !== undefined));
}

function sameValue(column: WizardColumn, draft: unknown, current: unknown): boolean {
  if (TIME_COLUMNS.has(column) && typeof draft === 'string' && typeof current === 'string') {
    return draft.slice(0, 5) === current.slice(0, 5);
  }
  if (Array.isArray(draft)) return JSON.stringify(draft) === JSON.stringify(current);
  return draft === current;
}

/** Text the import could not place, before the secrets are scrubbed from it. */
type Leftover = { text: string; fieldId: ImportableFieldId | null };

const rawText = (raw: unknown) => (typeof raw === 'object' ? JSON.stringify(raw) : String(raw));

/** The extracted columns of a field that the manual states, before validation. */
function statedColumns(
  fieldId: ImportableFieldId,
  fields: ManualExtractionData['fields'],
): Partial<Record<WizardColumn, unknown>> {
  if (fieldId === 'wifi') {
    if (fields.noWifi === true) return { noWifi: true };
    const stated: Partial<Record<WizardColumn, unknown>> = {};
    if (fields.wifiNetwork !== null) stated.wifiNetwork = fields.wifiNetwork;
    if (fields.wifiPassword !== null) stated.wifiPassword = fields.wifiPassword;
    if (Object.keys(stated).length > 0) return { noWifi: false, ...stated };
    return fields.noWifi === false ? { noWifi: false } : {};
  }
  const stated: Partial<Record<WizardColumn, unknown>> = {};
  for (const column of wizardField(fieldId).columns) {
    const value = (fields as Record<string, unknown>)[column];
    if (value === null || value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    stated[column] = value;
  }
  return stated;
}

function fieldDrafts(
  fields: ManualExtractionData['fields'],
  current: WizardValues,
): { drafts: DraftInput[]; unmapped: Leftover[] } {
  const drafts: DraftInput[] = [];
  const unmapped: Leftover[] = [];
  for (const fieldId of IMPORTABLE_FIELD_IDS) {
    const field = wizardField(fieldId);
    const values: Partial<Record<WizardColumn, unknown>> = {};
    for (const [column, raw] of Object.entries(statedColumns(fieldId, fields)) as [
      WizardColumn,
      unknown,
    ][]) {
      const parsed = columnSchema(field, column).safeParse(raw);
      if (!parsed.success) {
        unmapped.push({ text: rawText(raw), fieldId });
        continue;
      }
      // Empty after markup stripping: nothing stated.
      if (parsed.data === null) continue;
      if (!sameValue(column, parsed.data, current[column])) values[column] = parsed.data;
    }
    if (Object.keys(values).length > 0) drafts.push({ kind: 'field', fieldId, values });
  }
  return { drafts, unmapped };
}

const AmenityEntry = AmenitiesBody.shape.amenities.element;

function amenityDraft(
  amenities: ManualExtractionData['amenities'],
  present: readonly Amenity[],
): { drafts: DraftInput[]; unmapped: Leftover[] } {
  const seen = new Set<Amenity>(present);
  const list: { amenity: Amenity; note: string | null }[] = [];
  const unmapped: Leftover[] = [];
  for (const entry of amenities) {
    if (seen.has(entry.amenity)) continue;
    seen.add(entry.amenity);
    const parsed = AmenityEntry.safeParse(entry);
    // A note the validator rejects becomes unmapped; the amenity itself is still worth proposing.
    if (!parsed.success && entry.note) unmapped.push({ text: entry.note, fieldId: null });
    list.push({ amenity: entry.amenity, note: parsed.success ? (parsed.data.note ?? null) : null });
  }
  return { drafts: list.length > 0 ? [{ kind: 'amenities', amenities: list }] : [], unmapped };
}

const Title = line(LIMITS.title);

function blockDrafts(
  extraction: ManualExtractionData,
  secrets: readonly (string | null)[],
): { drafts: DraftInput[]; unmapped: Leftover[] } {
  const drafts: DraftInput[] = [];
  const unmapped: Leftover[] = [];
  const usedKeys = new Set<WizardPromptKey>();
  for (const block of scrubSecrets(extraction.blocks, secrets)) {
    const title = Title.safeParse(block.title);
    const body = stripMarkdownHtml(block.body);
    if (!title.success || body === '') {
      // The title too: one over the limit is still the host's text.
      const text = [stripMarkup(block.title), body].filter(Boolean).join('\n\n');
      if (text) unmapped.push({ text, fieldId: null });
      continue;
    }
    if (drafts.length >= LIMITS.manualBlocks) {
      unmapped.push({ text: `${title.data}\n\n${body}`, fieldId: null });
      continue;
    }
    let wizardKey = block.wizardKey;
    if (wizardKey !== null) {
      if (usedKeys.has(wizardKey)) wizardKey = null;
      else usedKeys.add(wizardKey);
    }
    drafts.push({
      kind: 'block',
      category: block.category,
      wizardKey,
      title: title.data,
      body,
      scrubbed: block.scrubbed,
      warnings: findSecretLikeText(`${title.data}\n${body}`),
    });
  }
  return { drafts, unmapped };
}

/**
 * The unmapped drafts: the leftovers, then the model's own unmapped paragraphs not already among
 * them. A host can place any of them as a block, so the secrets are scrubbed from all of them.
 */
function unmappedDrafts(
  leftovers: readonly Leftover[],
  paragraphs: readonly string[],
  secrets: readonly (string | null)[],
): DraftInput[] {
  const all = [...leftovers];
  const taken = new Set(leftovers.map((l) => l.text));
  for (const raw of paragraphs) {
    const text = stripMarkup(raw);
    if (!text || taken.has(text)) continue;
    taken.add(text);
    all.push({ text, fieldId: null });
  }
  const texts = scrubTexts(
    all.map((l) => l.text),
    secrets,
  );
  return all.map((l, i) => ({ kind: 'unmapped', text: texts[i] ?? '', fieldId: l.fieldId }));
}

/**
 * The drafts of one import, in order: fields (in wizard order), amenities, blocks, unmapped.
 * Values equal to what is already saved are left out.
 */
export function buildDrafts(
  extraction: ManualExtractionData,
  current: { values: WizardValues; amenities: readonly Amenity[] },
): ManualDraftItem[] {
  const secrets = SECRET_COLUMNS.map((c) => extraction.fields[c]);
  const fields = fieldDrafts(extraction.fields, current.values);
  const amenities = amenityDraft(extraction.amenities, current.amenities);
  const blocks = blockDrafts(extraction, secrets);
  const leftovers = [...fields.unmapped, ...amenities.unmapped, ...blocks.unmapped];
  const items: DraftInput[] = [
    ...fields.drafts,
    ...amenities.drafts,
    ...blocks.drafts,
    ...unmappedDrafts(leftovers, extraction.unmapped, secrets),
  ];
  return items.map(
    (item, i) => ({ ...item, id: `d${i + 1}`, status: 'pending' }) as ManualDraftItem,
  );
}
