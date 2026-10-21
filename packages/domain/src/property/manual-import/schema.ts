import { z } from 'zod';
import type { SecretWarning } from '../secrets';
import {
  AMENITIES,
  type Amenity,
  BED_TYPES,
  CHECK_IN_METHODS,
  type DraftStatus,
  HOST_BLOCK_CATEGORIES,
  type HostBlockCategory,
  PARKING_TYPES,
} from '../vocabulary';
import {
  WIZARD_PROMPT_KEYS,
  type WizardFieldId,
  type WizardPromptKey,
  type WizardValues,
} from '../wizard-config';

/**
 * Wizard fields a manual can fill: every property, unit and core field except the coordinates
 * and the arrival release (a Fetivi setting). Amenities are their own draft. A test checks this
 * list against WIZARD_FIELDS, so a new wizard field cannot be forgotten.
 */
export const IMPORTABLE_FIELD_IDS = [
  'address',
  'check_in_time',
  'check_in_method',
  'access_instructions',
  'building_door_code',
  'door_code',
  'lockbox_code',
  'wifi',
  'parking',
  'occupancy',
  'rooms_beds',
  'checkout_time',
  'house_rules',
  'quiet_hours',
  'house_rules_notes',
  'licence_number',
  'host_phone',
  'emergency_contact',
] as const satisfies readonly WizardFieldId[];
export type ImportableFieldId = (typeof IMPORTABLE_FIELD_IDS)[number];

/** The columns that hold secrets; their values must never appear in block text. */
export const SECRET_COLUMNS = [
  'wifiPassword',
  'doorCode',
  'lockboxCode',
  'buildingDoorCode',
  'hostPhone',
  'emergencyContactPhone',
] as const;

const HOST_CATEGORIES = HOST_BLOCK_CATEGORIES as [HostBlockCategory, ...HostBlockCategory[]];
const text = z.string().nullable();

/**
 * The structured output of the one model call. No length or pattern limits here: the API
 * validators enforce them after the call, and an invalid value becomes an unmapped draft.
 */
export const ManualExtraction = z.strictObject({
  fields: z.strictObject({
    addressLine: text,
    city: text,
    postalCode: text,
    buildingDoorCode: text,
    checkInTime: text,
    checkoutTime: text,
    checkInMethod: z.enum(CHECK_IN_METHODS).nullable(),
    accessInstructions: text,
    parkingType: z.enum(PARKING_TYPES).nullable(),
    parkingNotes: text,
    petsAllowed: z.boolean().nullable(),
    smokingAllowed: z.boolean().nullable(),
    partiesAllowed: z.boolean().nullable(),
    quietHoursFrom: text,
    quietHoursTo: text,
    houseRulesNotes: text,
    hostPhone: text,
    emergencyContactName: text,
    emergencyContactPhone: text,
    licenceNumber: text,
    noWifi: z.boolean().nullable(),
    wifiNetwork: text,
    wifiPassword: text,
    doorCode: text,
    lockboxCode: text,
    maxOccupancy: z.number().int().nullable(),
    bedrooms: z.number().int().nullable(),
    bathrooms: z.number().int().nullable(),
    beds: z.array(z.strictObject({ type: z.enum(BED_TYPES), count: z.number().int() })),
  }),
  amenities: z.array(z.strictObject({ amenity: z.enum(AMENITIES), note: text })),
  blocks: z.array(
    z.strictObject({
      category: z.enum(HOST_CATEGORIES),
      wizardKey: z.enum(WIZARD_PROMPT_KEYS).nullable(),
      title: z.string(),
      body: z.string(),
    }),
  ),
  unmapped: z.array(z.string()),
});
export type ManualExtractionData = z.infer<typeof ManualExtraction>;

export type WizardColumn = keyof WizardValues;

interface DraftBase {
  /** 'd1', 'd2', … in the import's order. */
  id: string;
  status: DraftStatus;
}

export type ManualDraftItem = DraftBase &
  (
    | { kind: 'field'; fieldId: ImportableFieldId; values: Partial<Record<WizardColumn, unknown>> }
    | { kind: 'amenities'; amenities: { amenity: Amenity; note: string | null }[] }
    | {
        kind: 'block';
        category: HostBlockCategory;
        wizardKey: WizardPromptKey | null;
        title: string;
        body: string;
        /** A secret value was replaced with *** in the text. */
        scrubbed: boolean;
        warnings: SecretWarning[];
      }
    | { kind: 'unmapped'; text: string; fieldId: ImportableFieldId | null }
  );
