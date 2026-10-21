import { type Amenity, SHARED_CORE_FIELDS } from '@fetivi/domain/vocabulary';
import {
  fieldsOfStep,
  type WizardField,
  type WizardFieldId,
  type WizardPromptKey,
  type WizardStepId,
  type WizardValues,
} from '@fetivi/domain/wizard';
import type {
  Block,
  CoreValues,
  PropertyDetail,
  PropertyPatch,
  UnitDetail,
  UnitPatch,
} from '../../api';

// Where each wizard field writes, and the PATCH bodies of one step. Pure, so it is unit tested.

export type WizardColumn = keyof WizardValues;

/** The values a step edits, as the forms hold them: the location as coordinates. */
export type DraftValues = Omit<WizardValues, 'location'> & {
  location: { lat: number; lng: number } | null;
};

const CORE_COLUMNS: ReadonlySet<string> = new Set(SHARED_CORE_FIELDS);
const isCore = (column: WizardColumn): column is keyof CoreValues => CORE_COLUMNS.has(column);

/**
 * Property fields go to the property and unit fields to the unit. A shared core field goes to the
 * unit when the unit already overrides any of its columns, else to the property, so one value
 * serves every unit of a single-unit property.
 */
export function fieldTarget(field: WizardField, detail: UnitDetail): 'property' | 'unit' {
  if (field.kind === 'unit') return 'unit';
  if (field.kind !== 'core') return 'property';
  return field.columns.some((c) => isCore(c) && detail[c] !== null) ? 'unit' : 'property';
}

/** The values as saved: a core field shows the unit's override, else the property's value. */
export function loadedValues(detail: UnitDetail, property: PropertyDetail): DraftValues {
  const core = {} as Record<keyof CoreValues, unknown>;
  for (const key of SHARED_CORE_FIELDS) core[key] = detail[key] ?? property[key];
  return {
    ...(core as CoreValues),
    addressLine: property.addressLine,
    city: property.city,
    postalCode: property.postalCode,
    location: property.location,
    buildingDoorCode: property.buildingDoorCode,
    noWifi: detail.noWifi,
    wifiNetwork: detail.wifiNetwork,
    wifiPassword: detail.wifiPassword,
    doorCode: detail.doorCode,
    lockboxCode: detail.lockboxCode,
    maxOccupancy: detail.maxOccupancy,
    bedrooms: detail.bedrooms,
    bathrooms: detail.bathrooms,
    beds: detail.beds,
    arrivalReleaseDaysBefore: detail.arrivalReleaseDaysBefore,
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The minimal PATCH bodies for one step: only the changed columns of the step's visible fields,
 * so an untouched field is never cleared. Empty bodies are left out.
 */
export function fieldPatches(
  stepId: WizardStepId,
  visible: ReadonlySet<WizardFieldId>,
  draft: DraftValues,
  loaded: DraftValues,
  detail: UnitDetail,
): { property?: PropertyPatch; unit?: UnitPatch } {
  const property: Record<string, unknown> = {};
  const unit: Record<string, unknown> = {};
  for (const field of fieldsOfStep(stepId)) {
    if (!visible.has(field.id)) continue;
    const body = fieldTarget(field, detail) === 'unit' ? unit : property;
    for (const column of field.columns) {
      if (!same(draft[column], loaded[column])) body[column] = draft[column];
    }
  }
  return {
    ...(Object.keys(property).length > 0 ? { property: property as PropertyPatch } : {}),
    ...(Object.keys(unit).length > 0 ? { unit: unit as UnitPatch } : {}),
  };
}

/** The block that answers a prompt on this unit, wherever it lives. */
export function promptBlock(key: WizardPromptKey, detail: UnitDetail): Block | null {
  return detail.effective.blocks.find((b) => b.wizardKey === key) ?? null;
}

/** The property's amenity list with one amenity switched on or off, keeping the notes. */
export function toggledAmenities(
  current: PropertyDetail['amenities'],
  amenity: Amenity,
  on: boolean,
): PropertyDetail['amenities'] {
  const rest = current.filter((a) => a.amenity !== amenity);
  return on ? [...rest, { amenity, note: null }] : rest;
}
