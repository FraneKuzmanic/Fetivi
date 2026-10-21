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
): { drafts: DraftInput[]; unmapped: DraftInput[] } {
  const drafts: DraftInput[] = [];
  const unmapped: DraftInput[] = [];
  for (const fieldId of IMPORTABLE_FIELD_IDS) {
    const field = wizardField(fieldId);
    const values: Partial<Record<WizardColumn, unknown>> = {};
    for (const [column, raw] of Object.entries(statedColumns(fieldId, fields)) as [
      WizardColumn,
      unknown,
    ][]) {
      const parsed = columnSchema(field, column).safeParse(raw);
      if (!parsed.success) {
        unmapped.push({ kind: 'unmapped', text: rawText(raw), fieldId });
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
): DraftInput[] {
  const seen = new Set<Amenity>(present);
  const list: { amenity: Amenity; note: string | null }[] = [];
  for (const entry of amenities) {
    if (seen.has(entry.amenity)) continue;
    seen.add(entry.amenity);
    const parsed = AmenityEntry.safeParse(entry);
    // A note over the limit is dropped; the amenity itself is still worth proposing.
    list.push({ amenity: entry.amenity, note: parsed.success ? (parsed.data.note ?? null) : null });
  }
  return list.length > 0 ? [{ kind: 'amenities', amenities: list }] : [];
}

const Title = line(LIMITS.title);

function blockDrafts(extraction: ManualExtractionData): {
  drafts: DraftInput[];
  unmapped: DraftInput[];
} {
  const secrets = SECRET_COLUMNS.map((c) => extraction.fields[c]);
  const drafts: DraftInput[] = [];
  const unmapped: DraftInput[] = [];
  const usedKeys = new Set<WizardPromptKey>();
  for (const block of scrubSecrets(extraction.blocks, secrets)) {
    const title = Title.safeParse(block.title);
    const body = stripMarkdownHtml(block.body);
    if (!title.success || body === '') {
      const text = body || stripMarkup(block.title);
      if (text) unmapped.push({ kind: 'unmapped', text, fieldId: null });
      continue;
    }
    if (drafts.length >= LIMITS.manualBlocks) {
      unmapped.push({ kind: 'unmapped', text: `${title.data}\n\n${body}`, fieldId: null });
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

function unmappedDrafts(texts: readonly string[], taken: Set<string>): DraftInput[] {
  const out: DraftInput[] = [];
  for (const raw of texts) {
    const text = stripMarkup(raw);
    if (!text || taken.has(text)) continue;
    taken.add(text);
    out.push({ kind: 'unmapped', text, fieldId: null });
  }
  return out;
}

/**
 * The drafts of one import, in order: fields (in wizard order), amenities, blocks, unmapped.
 * Values equal to what is already saved are left out.
 */
export function buildDrafts(
  extraction: ManualExtractionData,
  current: { values: WizardValues; amenities: readonly Amenity[] },
): ManualDraftItem[] {
  const fields = fieldDrafts(extraction.fields, current.values);
  const blocks = blockDrafts(extraction);
  const leftovers = [...fields.unmapped, ...blocks.unmapped];
  const taken = new Set(leftovers.map((u) => (u.kind === 'unmapped' ? u.text : '')));
  const items: DraftInput[] = [
    ...fields.drafts,
    ...amenityDraft(extraction.amenities, current.amenities),
    ...blocks.drafts,
    ...leftovers,
    ...unmappedDrafts(extraction.unmapped, taken),
  ];
  return items.map(
    (item, i) => ({ ...item, id: `d${i + 1}`, status: 'pending' }) as ManualDraftItem,
  );
}
