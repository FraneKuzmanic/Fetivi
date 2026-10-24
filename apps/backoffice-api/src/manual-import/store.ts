import {
  type Db,
  type Executor,
  findSecretLikeText,
  type HostBlockCategory,
  infoBlocks,
  type JobQueue,
  LIMITS,
  loadEffectiveUnit,
  type ManualDraftItem,
  type ManualImportRow,
  type ManualSource,
  manualImports,
  type PropertyRow,
  properties,
  propertyAmenities,
  type SecretWarning,
  syncAmenityNoteTexts,
  syncFieldTexts,
  type UnitRow,
  units,
  type WizardPromptKey,
  wizardField,
} from '@fetivi/domain';
import { eq, sql } from 'drizzle-orm';
import { HttpError } from '../http-error';
import { countBlocks, saveBlock } from '../properties/store';
import { type ConfirmInput, parseConfirm } from './schemas';

type Owned = { unit: UnitRow; property: PropertyRow };
/** Plus the unit's effective prompt blocks, by wizard key: a confirmed prompt draft updates its block. */
type Target = Owned & { promptBlockIds: Map<string, string> };

const notFound = () => new HttpError(404, 'not-found');

export async function getImport(db: Executor, unitId: string) {
  const [row] = await db.select().from(manualImports).where(eq(manualImports.unitId, unitId));
  return row ?? null;
}

/** Stores a new import for the unit, replacing any previous one with its drafts. */
export async function replaceImport(
  db: Db,
  input: { unitId: string; source: ManualSource; items: ManualDraftItem[]; now: Date },
) {
  const { unitId, source, items, now } = input;
  const [row] = await db
    .insert(manualImports)
    .values({ unitId, source, items, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: manualImports.unitId,
      set: { id: sql`gen_random_uuid()`, source, items, createdAt: now, updatedAt: now },
    })
    .returning();
  if (!row) throw new Error('manual import upsert returned nothing');
  return row;
}

export function importOut(row: ManualImportRow) {
  return {
    id: row.id,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
    items: row.items,
  };
}

/** The wizard's routing: a core field goes to the unit when the unit overrides it. */
function fieldTarget(
  fieldId: Extract<ManualDraftItem, { kind: 'field' }>['fieldId'],
  unit: UnitRow,
) {
  const field = wizardField(fieldId);
  if (field.kind === 'unit') return 'unit';
  if (field.kind === 'property') return 'property';
  return field.columns.some((c) => (unit as Record<string, unknown>)[c] != null)
    ? 'unit'
    : 'property';
}

/** Writes a confirmed block: the prompt block it answers is updated, else a new property block. */
async function writeBlock(
  tx: Executor,
  queue: JobQueue,
  target: Target,
  block: {
    category: HostBlockCategory;
    wizardKey: WizardPromptKey | null;
    title: string;
    body: string;
  },
  now: Date,
) {
  const existingId = block.wizardKey ? target.promptBlockIds.get(block.wizardKey) : undefined;
  if (existingId) {
    const hostId = target.property.hostId;
    const changes = { title: block.title, body: block.body };
    return saveBlock(tx, queue, { update: { id: existingId, hostId, changes, now } });
  }
  const propertyId = target.property.id;
  if ((await countBlocks(tx, { propertyId })) >= LIMITS.blocksPerOwner) {
    throw new HttpError(400, 'invalid-input');
  }
  const [last] = await tx
    .select({ max: sql<number | null>`max(${infoBlocks.position})` })
    .from(infoBlocks)
    .where(eq(infoBlocks.propertyId, propertyId));
  const visibility = block.wizardKey
    ? (wizardField(block.wizardKey).prompt?.visibility ?? 'always')
    : block.category === 'arrival_access'
      ? 'after_release'
      : 'always';
  return saveBlock(tx, queue, {
    insert: {
      propertyId,
      category: block.category,
      wizardKey: block.wizardKey,
      title: block.title,
      body: block.body,
      visibility,
      position: (last?.max ?? -1) + 1,
    },
  });
}

/** Applies one confirmed draft and returns the item as saved. */
async function applyItem(
  tx: Executor,
  queue: JobQueue,
  target: Target,
  item: ManualDraftItem,
  input: ConfirmInput,
  now: Date,
): Promise<{ item: ManualDraftItem; warnings: SecretWarning[] }> {
  if (item.kind === 'field' && input.kind === 'field') {
    const values = input.values;
    // Ticket 50: field texts follow the saved row in the same transaction.
    if (fieldTarget(item.fieldId, target.unit) === 'unit') {
      const [row] = await tx
        .update(units)
        .set({ ...values, updatedAt: now })
        .where(eq(units.id, target.unit.id))
        .returning();
      if (row) await syncFieldTexts(tx, queue, { unitId: row.id }, row, now);
    } else {
      const [row] = await tx
        .update(properties)
        .set({ ...values, updatedAt: now })
        .where(eq(properties.id, target.property.id))
        .returning();
      if (row) await syncFieldTexts(tx, queue, { propertyId: row.id }, row, now);
    }
    return { item: { ...item, values }, warnings: [] };
  }
  if (item.kind === 'amenities' && input.kind === 'amenities') {
    const amenities = input.amenities.map((a) => ({ amenity: a.amenity, note: a.note ?? null }));
    // Add-only: an amenity the property already lists keeps its note.
    await tx
      .insert(propertyAmenities)
      .values(amenities.map((a) => ({ propertyId: target.property.id, ...a })))
      .onConflictDoNothing();
    // Ticket 50: the full saved list, so no other note's field text is dropped.
    const saved = await tx
      .select({ amenity: propertyAmenities.amenity, note: propertyAmenities.note })
      .from(propertyAmenities)
      .where(eq(propertyAmenities.propertyId, target.property.id));
    await syncAmenityNoteTexts(tx, queue, { propertyId: target.property.id }, saved, now);
    return { item: { ...item, amenities }, warnings: [] };
  }
  if (item.kind === 'block' && input.kind === 'block') {
    const saved = await writeBlock(tx, queue, target, { ...item, ...input }, now);
    const warnings = findSecretLikeText(`${saved.title}\n${saved.body}`);
    return { item: { ...item, title: saved.title, body: saved.body, warnings }, warnings };
  }
  if (item.kind === 'unmapped' && input.kind === 'unmapped') {
    const saved = await writeBlock(tx, queue, target, { ...input, wizardKey: null }, now);
    return {
      item: { ...item, text: saved.body },
      warnings: findSecretLikeText(`${saved.title}\n${saved.body}`),
    };
  }
  throw new Error('confirm input does not match the draft');
}

/**
 * Confirms or dismisses one draft in one transaction with its writes. The import row is locked,
 * so two tabs resolving the same draft cannot both apply it.
 */
export async function resolveItem(
  db: Db,
  queue: JobQueue,
  input: { owned: Owned; itemId: string; action: 'confirm' | 'dismiss'; body: unknown; now: Date },
) {
  const { owned, itemId, action, now } = input;
  // Read before the transaction; the block update itself locks the block it writes.
  const effective = action === 'confirm' ? await loadEffectiveUnit(db, owned.unit.id) : null;
  const promptBlockIds = new Map<string, string>();
  for (const block of effective?.blocks ?? []) {
    if (block.wizardKey && !promptBlockIds.has(block.wizardKey)) {
      promptBlockIds.set(block.wizardKey, block.id);
    }
  }
  const target = { ...owned, promptBlockIds };
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(manualImports)
      .where(eq(manualImports.unitId, owned.unit.id))
      .for('update');
    if (!row) throw notFound();
    const index = row.items.findIndex((i) => i.id === itemId);
    const item = row.items[index];
    if (!item) throw notFound();
    if (item.status !== 'pending') throw new HttpError(409, 'draft-resolved');

    let resolved: ManualDraftItem = { ...item, status: 'dismissed' };
    let warnings: SecretWarning[] = [];
    if (action === 'confirm') {
      const applied = await applyItem(tx, queue, target, item, parseConfirm(item, input.body), now);
      resolved = { ...applied.item, status: 'confirmed' };
      warnings = applied.warnings;
    }
    const items = row.items.map((i, n) => (n === index ? resolved : i));
    const [updated] = await tx
      .update(manualImports)
      .set({ items, updatedAt: now })
      .where(eq(manualImports.id, row.id))
      .returning();
    if (!updated) throw notFound();
    return { row: updated, warnings };
  });
}
