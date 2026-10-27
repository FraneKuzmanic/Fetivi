// Pure setup-wizard progress: field levels, filled state, completeness and resume (ticket 20).

import type { BlockCategory, PropertyType } from './vocabulary';
import {
  answersPrompt,
  levelFor,
  WIZARD_FIELDS,
  WIZARD_STEP_IDS,
  type WizardField,
  type WizardFieldId,
  type WizardLevelOrHidden,
  type WizardPromptKey,
  type WizardStepId,
  type WizardValues,
  wizardField,
} from './wizard-config';

export interface WizardBlockFact {
  wizardKey: string | null;
  category: BlockCategory;
  revision: number;
  publishedRevision: number | null;
}

export interface WizardFacts {
  propertyType: PropertyType | null;
  approved: boolean;
  /** qrSlug !== null. */
  live: boolean;
  values: WizardValues;
  amenityCount: number;
  /** The unit's effective (non-hidden) blocks. */
  blocks: WizardBlockFact[];
}

export function fieldLevel(field: WizardField, facts: WizardFacts): WizardLevelOrHidden {
  return levelFor(field, facts.propertyType, facts.values.checkInMethod);
}

const set = (v: unknown) => v !== null && v !== undefined && v !== '';

/** Fields whose "filled" is more than "the first column is set". */
const FILLED: Partial<Record<WizardFieldId, (v: WizardValues) => boolean>> = {
  address: (v) => set(v.addressLine) && set(v.city),
  wifi: (v) => v.noWifi || (set(v.wifiNetwork) && set(v.wifiPassword)),
  rooms_beds: (v) => v.beds.length > 0,
  house_rules: (v) => set(v.petsAllowed) && set(v.smokingAllowed) && set(v.partiesAllowed),
  quiet_hours: (v) => set(v.quietHoursFrom) && set(v.quietHoursTo),
  emergency_contact: (v) => set(v.emergencyContactPhone),
  location: (v) => v.location,
  // Has a default, so it is always answered.
  arrival_release: () => true,
};

export function isFilled(fieldId: WizardFieldId, facts: WizardFacts): boolean {
  const field = wizardField(fieldId);
  if (field.kind === 'prompt') {
    return facts.blocks.some((b) => answersPrompt(b, fieldId as WizardPromptKey));
  }
  if (field.kind === 'amenities') return facts.amenityCount > 0;
  const rule = FILLED[fieldId];
  if (rule) return rule(facts.values);
  const [first] = field.columns;
  return first !== undefined && set(facts.values[first]);
}

/** The fields of a step the host sees for these facts, in order. */
export function visibleFields(stepId: WizardStepId, facts: WizardFacts): WizardField[] {
  return WIZARD_FIELDS.filter((f) => f.step === stepId && fieldLevel(f, facts) !== 'hidden');
}

export interface StepProgress {
  filled: number;
  total: number;
  missingRequired: WizardFieldId[];
  missingRecommended: WizardFieldId[];
}

export interface WizardProgress {
  percent: number;
  filled: number;
  total: number;
  steps: Record<WizardStepId, StepProgress>;
}

/** Completeness over Required and Recommended fields; Optional and hidden ones do not count. */
export function wizardProgress(facts: WizardFacts): WizardProgress {
  const steps = {} as Record<WizardStepId, StepProgress>;
  let filled = 0;
  let total = 0;
  for (const stepId of WIZARD_STEP_IDS) {
    const step: StepProgress = { filled: 0, total: 0, missingRequired: [], missingRecommended: [] };
    for (const field of WIZARD_FIELDS) {
      if (field.step !== stepId) continue;
      const level = fieldLevel(field, facts);
      if (level !== 'required' && level !== 'recommended') continue;
      step.total += 1;
      if (isFilled(field.id, facts)) step.filled += 1;
      else if (level === 'required') step.missingRequired.push(field.id);
      else step.missingRecommended.push(field.id);
    }
    steps[stepId] = step;
    filled += step.filled;
    total += step.total;
  }
  return { percent: total === 0 ? 100 : Math.round((100 * filled) / total), filled, total, steps };
}

/** Where the wizard reopens: first step missing a Required field, else a Recommended one. */
export function resumeStep(facts: WizardFacts): WizardStepId | null {
  const { steps } = wizardProgress(facts);
  return (
    WIZARD_STEP_IDS.find((s) => steps[s].missingRequired.length > 0) ??
    WIZARD_STEP_IDS.find((s) => steps[s].missingRecommended.length > 0) ??
    null
  );
}
