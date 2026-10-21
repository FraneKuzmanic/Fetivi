import {
  type Db,
  fieldLevel,
  goLiveCheck,
  isFilled,
  loadEffectiveUnit,
  type PropertyRow,
  properties,
  resumeStep,
  type UnitRow,
  units,
  WIZARD_FIELDS,
  type WizardFieldId,
  type WizardLevel,
  wizardFacts,
  wizardProgress,
} from '@fetivi/domain';
import { and, eq, isNull } from 'drizzle-orm';
import { HttpError } from '../http-error';
import { issueSlug } from './store';

// The setup wizard's status and the go-live step (ticket 20, ADR 0004). A unit is live once it has
// its QR slug; the slug is issued only here, when the property is approved and the minimum is met.

async function effectiveOf(db: Db, unitId: string) {
  const effective = await loadEffectiveUnit(db, unitId);
  if (!effective) throw new HttpError(404, 'not-found');
  return effective;
}

/** Everything the wizard shows, computed on the server so the rules have one implementation. */
export async function wizardStatus(db: Db, owned: { unit: UnitRow; property: PropertyRow }) {
  const effective = await effectiveOf(db, owned.unit.id);
  const facts = wizardFacts(effective);
  const fields: Partial<Record<WizardFieldId, { level: WizardLevel; filled: boolean }>> = {};
  for (const field of WIZARD_FIELDS) {
    const level = fieldLevel(field, facts);
    if (level !== 'hidden') fields[field.id] = { level, filled: isFilled(field.id, facts) };
  }
  return {
    unitId: effective.unitId,
    propertyId: effective.propertyId,
    unitName: effective.unitName,
    propertyName: effective.propertyName,
    propertyType: effective.propertyType,
    approved: facts.approved,
    live: facts.live,
    fields,
    progress: wizardProgress(facts),
    resumeStep: resumeStep(facts),
    goLive: goLiveCheck(facts),
  };
}

/** Issues the unit's slug when it passes the go-live check. Idempotent: a live unit stays as is. */
export async function goLiveUnit(db: Db, unitId: string): Promise<void> {
  const effective = await effectiveOf(db, unitId);
  if (effective.qrSlug) return;
  const check = goLiveCheck(wizardFacts(effective));
  if (check.missing.includes('approval')) throw new HttpError(409, 'not-approved');
  if (!check.ready) throw new HttpError(409, 'not-ready');
  await db.transaction(async (tx) => {
    // Shared lock: approval is one-way, but the check above read it outside this transaction.
    const [property] = await tx
      .select({ approvedAt: properties.approvedAt })
      .from(properties)
      .where(eq(properties.id, effective.propertyId))
      .for('share');
    if (!property?.approvedAt) throw new HttpError(409, 'not-approved');
    await issueSlug(tx, unitId);
  });
}

/**
 * The slugless units of a property that meet the minimum, as if it were approved. Approval reads
 * this before its transaction (the facts do not change by approving) and issues their slugs in it.
 */
export async function readyUnitIds(db: Db, propertyId: string): Promise<string[]> {
  const slugless = await db
    .select({ id: units.id })
    .from(units)
    .where(and(eq(units.propertyId, propertyId), isNull(units.qrSlug)));
  const ready: string[] = [];
  for (const { id } of slugless) {
    const effective = await loadEffectiveUnit(db, id);
    if (effective && goLiveCheck({ ...wizardFacts(effective), approved: true }).ready) {
      ready.push(id);
    }
  }
  return ready;
}
