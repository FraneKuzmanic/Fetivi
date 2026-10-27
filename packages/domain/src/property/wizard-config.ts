// The setup wizard's steps and fields (ticket 20). Browser-safe: imports only the vocabulary.
// Copy (labels, why, examples) lives in ./wizard-copy, keyed by the ids declared here.
import {
  type Bed,
  BLOCK_CATEGORIES,
  type BlockCategory,
  type BlockVisibility,
  type CheckInMethod,
  type HostBlockCategory,
  type ParkingType,
  type PropertyType,
} from './vocabulary';

/** One step per Guide section. The ids are stable: Suggestions (44) link to them. */
export const WIZARD_STEP_IDS = BLOCK_CATEGORIES;
export type WizardStepId = BlockCategory;

export const WIZARD_LEVELS = ['required', 'recommended', 'optional'] as const;
export type WizardLevel = (typeof WIZARD_LEVELS)[number];
export type WizardLevelOrHidden = WizardLevel | 'hidden';

/**
 * Where a field's value lives. `core` is a shared core field: the unit's value when the unit
 * overrides it, else the property's. `prompt` is a suggested Info block, matched by wizardKey.
 */
export type WizardFieldKind = 'property' | 'unit' | 'core' | 'amenities' | 'prompt';

/** Every value the wizard fields read, after inheritance. `location` only says whether it is set. */
export interface WizardValues {
  addressLine: string | null;
  city: string | null;
  postalCode: string | null;
  location: boolean;
  buildingDoorCode: string | null;
  checkInTime: string | null;
  checkoutTime: string | null;
  checkInMethod: CheckInMethod | null;
  accessInstructions: string | null;
  parkingType: ParkingType | null;
  parkingNotes: string | null;
  petsAllowed: boolean | null;
  smokingAllowed: boolean | null;
  partiesAllowed: boolean | null;
  quietHoursFrom: string | null;
  quietHoursTo: string | null;
  houseRulesNotes: string | null;
  hostPhone: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  licenceNumber: string | null;
  noWifi: boolean;
  wifiNetwork: string | null;
  wifiPassword: string | null;
  doorCode: string | null;
  lockboxCode: string | null;
  maxOccupancy: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  beds: Bed[];
  arrivalReleaseDaysBefore: number;
}

export interface WizardFieldDef<Id extends string = string> {
  id: Id;
  step: WizardStepId;
  kind: WizardFieldKind;
  columns: readonly (keyof WizardValues)[];
  level: WizardLevelOrHidden;
  byType?: Partial<Record<PropertyType, WizardLevelOrHidden>>;
  byCheckInMethod?: Partial<Record<CheckInMethod, WizardLevelOrHidden>>;
  prompt?: { category: HostBlockCategory; visibility: BlockVisibility };
}

const always = (category: HostBlockCategory) => ({ category, visibility: 'always' }) as const;

const FIELDS = [
  // Arrival & access
  {
    id: 'address',
    step: 'arrival_access',
    kind: 'property',
    columns: ['addressLine', 'city', 'postalCode'],
    level: 'required',
  },
  {
    id: 'location',
    step: 'arrival_access',
    kind: 'property',
    columns: ['location'],
    level: 'recommended',
  },
  {
    id: 'check_in_time',
    step: 'arrival_access',
    kind: 'core',
    columns: ['checkInTime'],
    level: 'required',
  },
  {
    id: 'check_in_method',
    step: 'arrival_access',
    kind: 'core',
    columns: ['checkInMethod'],
    level: 'required',
  },
  {
    id: 'access_instructions',
    step: 'arrival_access',
    kind: 'core',
    columns: ['accessInstructions'],
    level: 'required',
  },
  {
    id: 'building_door_code',
    step: 'arrival_access',
    kind: 'property',
    columns: ['buildingDoorCode'],
    level: 'optional',
    byType: { house: 'hidden', villa: 'hidden' },
  },
  {
    id: 'door_code',
    step: 'arrival_access',
    kind: 'unit',
    columns: ['doorCode'],
    level: 'optional',
    byCheckInMethod: { keypad: 'recommended', smart_lock: 'recommended' },
  },
  {
    id: 'lockbox_code',
    step: 'arrival_access',
    kind: 'unit',
    columns: ['lockboxCode'],
    level: 'optional',
    byCheckInMethod: { lockbox: 'recommended', in_person: 'hidden', building_staff: 'hidden' },
  },
  {
    id: 'arrival_release',
    step: 'arrival_access',
    kind: 'unit',
    columns: ['arrivalReleaseDaysBefore'],
    level: 'optional',
  },
  {
    id: 'arrival_directions',
    step: 'arrival_access',
    kind: 'prompt',
    columns: [],
    level: 'recommended',
    prompt: { category: 'arrival_access', visibility: 'after_release' },
  },
  // Wi-Fi & essentials
  {
    id: 'wifi',
    step: 'wifi_essentials',
    kind: 'unit',
    columns: ['noWifi', 'wifiNetwork', 'wifiPassword'],
    level: 'required',
  },
  {
    id: 'amenities',
    step: 'wifi_essentials',
    kind: 'amenities',
    columns: [],
    level: 'recommended',
  },
  {
    id: 'parking',
    step: 'wifi_essentials',
    kind: 'core',
    columns: ['parkingType', 'parkingNotes'],
    level: 'recommended',
  },
  {
    id: 'occupancy',
    step: 'wifi_essentials',
    kind: 'unit',
    columns: ['maxOccupancy'],
    level: 'recommended',
  },
  {
    id: 'rooms_beds',
    step: 'wifi_essentials',
    kind: 'unit',
    columns: ['bedrooms', 'bathrooms', 'beds'],
    level: 'recommended',
  },
  {
    id: 'supplies',
    step: 'wifi_essentials',
    kind: 'prompt',
    columns: [],
    level: 'optional',
    prompt: always('wifi_essentials'),
  },
  // House rules & checkout
  {
    id: 'checkout_time',
    step: 'house_rules_checkout',
    kind: 'core',
    columns: ['checkoutTime'],
    level: 'required',
  },
  {
    id: 'house_rules',
    step: 'house_rules_checkout',
    kind: 'core',
    columns: ['petsAllowed', 'smokingAllowed', 'partiesAllowed'],
    level: 'recommended',
  },
  {
    id: 'quiet_hours',
    step: 'house_rules_checkout',
    kind: 'core',
    columns: ['quietHoursFrom', 'quietHoursTo'],
    level: 'optional',
    byType: {
      apartment: 'recommended',
      studio: 'recommended',
      room: 'recommended',
      guesthouse: 'recommended',
    },
  },
  {
    id: 'house_rules_notes',
    step: 'house_rules_checkout',
    kind: 'core',
    columns: ['houseRulesNotes'],
    level: 'optional',
  },
  {
    id: 'licence_number',
    step: 'house_rules_checkout',
    kind: 'core',
    columns: ['licenceNumber'],
    level: 'recommended',
  },
  {
    id: 'checkout_steps',
    step: 'house_rules_checkout',
    kind: 'prompt',
    columns: [],
    level: 'recommended',
    prompt: always('house_rules_checkout'),
  },
  {
    id: 'shared_spaces',
    step: 'house_rules_checkout',
    kind: 'prompt',
    columns: [],
    level: 'hidden',
    byType: { room: 'recommended', guesthouse: 'recommended' },
    prompt: always('house_rules_checkout'),
  },
  {
    id: 'rubbish_recycling',
    step: 'house_rules_checkout',
    kind: 'prompt',
    columns: [],
    level: 'optional',
    byType: { house: 'recommended', villa: 'recommended' },
    prompt: always('house_rules_checkout'),
  },
  // How-tos
  {
    id: 'heating_cooling',
    step: 'how_tos',
    kind: 'prompt',
    columns: [],
    level: 'recommended',
    prompt: always('how_tos'),
  },
  {
    id: 'kitchen_appliances',
    step: 'how_tos',
    kind: 'prompt',
    columns: [],
    level: 'optional',
    prompt: always('how_tos'),
  },
  {
    id: 'laundry',
    step: 'how_tos',
    kind: 'prompt',
    columns: [],
    level: 'optional',
    prompt: always('how_tos'),
  },
  {
    id: 'pool_outdoor',
    step: 'how_tos',
    kind: 'prompt',
    columns: [],
    level: 'hidden',
    byType: { villa: 'recommended', house: 'optional', guesthouse: 'optional' },
    prompt: always('how_tos'),
  },
  {
    id: 'hot_water',
    step: 'how_tos',
    kind: 'prompt',
    columns: [],
    level: 'optional',
    byType: { room: 'hidden' },
    prompt: always('how_tos'),
  },
  // Saved places: info only, no fields.
  // Host picks
  {
    id: 'neighbourhood_tips',
    step: 'host_picks',
    kind: 'prompt',
    columns: [],
    level: 'recommended',
    prompt: always('host_picks'),
  },
  // Contacts & emergency
  {
    id: 'host_phone',
    step: 'contacts_emergency',
    kind: 'core',
    columns: ['hostPhone'],
    level: 'required',
  },
  {
    id: 'emergency_contact',
    step: 'contacts_emergency',
    kind: 'core',
    columns: ['emergencyContactName', 'emergencyContactPhone'],
    level: 'recommended',
  },
  {
    id: 'medical_help',
    step: 'contacts_emergency',
    kind: 'prompt',
    columns: [],
    level: 'optional',
    prompt: always('contacts_emergency'),
  },
] as const satisfies readonly WizardFieldDef[];

type FieldLiteral = (typeof FIELDS)[number];
export type WizardFieldId = FieldLiteral['id'];
export type WizardPromptKey = Extract<FieldLiteral, { kind: 'prompt' }>['id'];
export type WizardField = WizardFieldDef<WizardFieldId>;

/** Every wizard field, in step and display order. */
export const WIZARD_FIELDS: readonly WizardField[] = FIELDS;
export const WIZARD_FIELD_IDS = WIZARD_FIELDS.map((f) => f.id);

/** The field ids of kind `prompt`: the values `info_blocks.wizard_key` may hold. */
export const WIZARD_PROMPT_KEYS = WIZARD_FIELDS.filter((f) => f.kind === 'prompt').map(
  (f) => f.id,
) as [WizardPromptKey, ...WizardPromptKey[]];

const byId = new Map(WIZARD_FIELDS.map((f) => [f.id, f]));
export function wizardField(id: WizardFieldId): WizardField {
  return byId.get(id) as WizardField;
}

/** Each guide section's prompt, for the sections only one prompt writes to. */
const SOLE_PROMPT: Partial<Record<BlockCategory, WizardPromptKey>> = (() => {
  const counts = new Map<BlockCategory, WizardPromptKey[]>();
  for (const f of WIZARD_FIELDS) {
    if (f.kind !== 'prompt' || !f.prompt) continue;
    counts.set(f.prompt.category, [
      ...(counts.get(f.prompt.category) ?? []),
      f.id as WizardPromptKey,
    ]);
  }
  return Object.fromEntries(
    [...counts].filter(([, keys]) => keys.length === 1).map(([category, [key]]) => [category, key]),
  );
})();

/**
 * Whether a guide entry answers a wizard prompt: it carries the prompt's key, or it was written
 * outside the wizard (no key) in a section only that prompt writes to, such as the Neighbourhood
 * tips on the Host picks page. Sections with several prompts match by key only.
 */
export function answersPrompt(
  block: { wizardKey: string | null; category: BlockCategory },
  key: WizardPromptKey,
): boolean {
  if (block.wizardKey !== null) return block.wizardKey === key;
  return SOLE_PROMPT[block.category] === key;
}

export function fieldsOfStep(stepId: WizardStepId): WizardField[] {
  return WIZARD_FIELDS.filter((f) => f.step === stepId);
}

export function isWizardStepId(value: string): value is WizardStepId {
  return (WIZARD_STEP_IDS as readonly string[]).includes(value);
}

/**
 * A field's level for a property type and check-in method. Precedence: a type's `hidden` wins
 * (a villa has no building door), then the method's level, then the type's, then the base.
 */
export function levelFor(
  field: WizardField,
  propertyType: PropertyType | null,
  checkInMethod: CheckInMethod | null,
): WizardLevelOrHidden {
  const byType = propertyType ? field.byType?.[propertyType] : undefined;
  if (byType === 'hidden') return 'hidden';
  const byMethod = checkInMethod ? field.byCheckInMethod?.[checkInMethod] : undefined;
  return byMethod ?? byType ?? field.level;
}

/** The back-office path of a wizard step, optionally scrolled to one field. */
export function wizardStepPath(
  unitId: string,
  stepId: WizardStepId,
  fieldId?: WizardFieldId,
): string {
  return `/units/${unitId}/setup/${stepId}${fieldId ? `#field-${fieldId}` : ''}`;
}
