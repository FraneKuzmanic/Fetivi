import { type Bed, LIMITS } from '@fetivi/domain/vocabulary';
import {
  WIZARD_STEP_IDS,
  type WizardCopy,
  type WizardStepId,
  wizardField,
} from '@fetivi/domain/wizard';
import type { ManualDraftColumn, ManualDraftItem, ManualImport } from '../../../api';
import type { DraftValues } from '../targets';

// Pure helpers of the import review page: grouping, counts, value formatting and input kinds.

/** The wizard step a draft belongs to; unmapped drafts belong to none. */
export function draftStepOf(item: ManualDraftItem): WizardStepId | null {
  switch (item.kind) {
    case 'field':
      return wizardField(item.fieldId).step;
    case 'amenities':
      return 'wifi_essentials';
    case 'block':
      return item.category;
    case 'unmapped':
      return null;
  }
}

/** The drafts per step, in wizard order with empty steps left out, and the unmapped ones apart. */
export function groupByStep(items: readonly ManualDraftItem[]) {
  const steps: [WizardStepId, ManualDraftItem[]][] = [];
  for (const stepId of WIZARD_STEP_IDS) {
    const ofStep = items.filter((i) => draftStepOf(i) === stepId);
    if (ofStep.length > 0) steps.push([stepId, ofStep]);
  }
  return { steps, unmapped: items.filter((i) => i.kind === 'unmapped') };
}

export interface PendingCounts {
  total: number;
  byStep: Partial<Record<WizardStepId, number>>;
}

/** Drafts still waiting for the host, in all and per step; unmapped ones count in the total only. */
export function pendingByStep(manualImport: ManualImport | null): PendingCounts {
  const byStep: Partial<Record<WizardStepId, number>> = {};
  let total = 0;
  for (const item of manualImport?.items ?? []) {
    if (item.status !== 'pending') continue;
    total++;
    const step = draftStepOf(item);
    if (step) byStep[step] = (byStep[step] ?? 0) + 1;
  }
  return { total, byStep };
}

export function summaryCounts(items: readonly ManualDraftItem[]) {
  const count = (status: ManualDraftItem['status']) =>
    items.filter((i) => i.status === status).length;
  return {
    pending: count('pending'),
    confirmed: count('confirmed'),
    dismissed: count('dismissed'),
  };
}

export type ColumnInput =
  | 'time'
  | 'enum'
  | 'tri'
  | 'bool'
  | 'int'
  | 'text'
  | 'long'
  | 'phone'
  | 'beds';

const INPUTS: Partial<Record<ManualDraftColumn, ColumnInput>> = {
  checkInTime: 'time',
  checkoutTime: 'time',
  quietHoursFrom: 'time',
  quietHoursTo: 'time',
  checkInMethod: 'enum',
  parkingType: 'enum',
  petsAllowed: 'tri',
  smokingAllowed: 'tri',
  partiesAllowed: 'tri',
  noWifi: 'bool',
  maxOccupancy: 'int',
  bedrooms: 'int',
  bathrooms: 'int',
  accessInstructions: 'long',
  houseRulesNotes: 'long',
  parkingNotes: 'long',
  hostPhone: 'phone',
  emergencyContactPhone: 'phone',
  beds: 'beds',
};

/** Which input edits a column in the draft editor. */
export function columnInput(column: ManualDraftColumn): ColumnInput {
  return INPUTS[column] ?? 'text';
}

/** The longest value a text column takes, as the API checks it. */
export function columnMaxLength(column: ManualDraftColumn): number {
  switch (column) {
    case 'buildingDoorCode':
    case 'doorCode':
    case 'lockboxCode':
      return LIMITS.code;
    case 'wifiPassword':
      return LIMITS.wifiPassword;
    case 'licenceNumber':
      return LIMITS.licence;
    case 'hostPhone':
    case 'emergencyContactPhone':
      return LIMITS.phone;
    case 'accessInstructions':
    case 'houseRulesNotes':
    case 'parkingNotes':
      return LIMITS.longText;
    default:
      return LIMITS.shortText;
  }
}

/** The columns a field draft holds, in the field's own order (the model's order varies). */
export function draftColumns(
  item: Extract<ManualDraftItem, { kind: 'field' }>,
): ManualDraftColumn[] {
  return (wizardField(item.fieldId).columns as readonly string[]).filter(
    (c) => c in item.values,
  ) as ManualDraftColumn[];
}

/** The label of one column: the field's own label, or the sub-label inside a multi-column field. */
export function columnLabel(
  item: Extract<ManualDraftItem, { kind: 'field' }>,
  column: ManualDraftColumn,
  copy: WizardCopy,
): string {
  if (wizardField(item.fieldId).columns.length === 1) return copy.fields[item.fieldId].label;
  const { ui } = copy;
  const sub: Partial<Record<ManualDraftColumn, string>> = {
    addressLine: ui.addressLine,
    city: ui.city,
    postalCode: ui.postalCode,
    noWifi: ui.noWifi,
    wifiNetwork: ui.wifiNetwork,
    wifiPassword: ui.wifiPassword,
    parkingType: ui.parkingType,
    parkingNotes: ui.parkingNotes,
    petsAllowed: ui.pets,
    smokingAllowed: ui.smoking,
    partiesAllowed: ui.parties,
    quietHoursFrom: ui.quietFrom,
    quietHoursTo: ui.quietTo,
    emergencyContactName: ui.emergencyName,
    emergencyContactPhone: ui.emergencyPhone,
    bedrooms: ui.bedrooms,
    bathrooms: ui.bathrooms,
    beds: ui.beds,
  };
  return sub[column] ?? copy.fields[item.fieldId].label;
}

/** A value as the host reads it: enums by their labels, booleans as Yes/No, beds as "2 × Double". */
export function formatDraftValue(
  column: ManualDraftColumn,
  value: unknown,
  copy: WizardCopy,
): string {
  if (value === null || value === undefined || value === '') return copy.ui.notSet;
  if (column === 'beds') {
    const beds = value as Bed[];
    if (beds.length === 0) return copy.ui.notSet;
    return beds.map((b) => `${b.count} × ${copy.bedTypes[b.type]}`).join(', ');
  }
  if (column === 'checkInMethod')
    return copy.checkInMethods[value as keyof WizardCopy['checkInMethods']];
  if (column === 'parkingType') return copy.parkingTypes[value as keyof WizardCopy['parkingTypes']];
  if (typeof value === 'boolean') return value ? copy.ui.yes : copy.ui.no;
  if (columnInput(column) === 'time') return String(value).slice(0, 5);
  return String(value);
}

const isEmpty = (v: unknown) =>
  v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

/**
 * The saved values a field draft would replace, formatted, or null when nothing is saved yet or
 * the saved values already match.
 */
export function savedSummary(
  item: Extract<ManualDraftItem, { kind: 'field' }>,
  loaded: DraftValues,
  copy: WizardCopy,
): string | null {
  const columns = draftColumns(item);
  const saved = columns.filter((c) => !isEmpty(loaded[c]));
  if (saved.length === 0) return null;
  const differs = columns.some(
    (c) =>
      JSON.stringify(loaded[c]) !== JSON.stringify(item.values[c]) &&
      !(columnInput(c) === 'time' && String(loaded[c]).slice(0, 5) === item.values[c]),
  );
  if (!differs) return null;
  return saved
    .map((c) =>
      columns.length > 1
        ? `${columnLabel(item, c, copy)} ${formatDraftValue(c, loaded[c], copy)}`
        : formatDraftValue(c, loaded[c], copy),
    )
    .join(' · ');
}
