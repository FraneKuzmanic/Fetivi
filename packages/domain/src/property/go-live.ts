// The go-live minimum (ticket 20, ADR 0004). Pure and browser-safe; the effective unit is a type only.
import { isFilled, type WizardBlockFact, type WizardFacts } from './completeness';
import type { EffectiveUnit } from './effective';
import type { WizardFieldId, WizardStepId } from './wizard-config';

export const GO_LIVE_ITEMS = [
  'approval',
  'address',
  'check_in_time',
  'check_in_method',
  'access_instructions',
  'checkout_time',
  'wifi',
  'host_phone',
  'translations',
] as const;
export type GoLiveItem = (typeof GO_LIVE_ITEMS)[number];

/** The go-live items that are wizard fields; exactly the wizard's Required fields. */
export const GO_LIVE_FIELD_ITEMS = GO_LIVE_ITEMS.filter(
  (i): i is Exclude<GoLiveItem, 'approval' | 'translations'> =>
    i !== 'approval' && i !== 'translations',
);

const stepOf: Record<(typeof GO_LIVE_FIELD_ITEMS)[number], WizardStepId> = {
  address: 'arrival_access',
  check_in_time: 'arrival_access',
  check_in_method: 'arrival_access',
  access_instructions: 'arrival_access',
  checkout_time: 'house_rules_checkout',
  wifi: 'wifi_essentials',
  host_phone: 'contacts_emergency',
};

/** Where the checklist links each item; approval and translations are not wizard fields. */
export const GO_LIVE_TARGETS: Record<
  GoLiveItem,
  { stepId: WizardStepId; fieldId: WizardFieldId } | null
> = {
  approval: null,
  translations: null,
  ...(Object.fromEntries(
    GO_LIVE_FIELD_ITEMS.map((i) => [i, { stepId: stepOf[i], fieldId: i }]),
  ) as Record<
    (typeof GO_LIVE_FIELD_ITEMS)[number],
    { stepId: WizardStepId; fieldId: WizardFieldId }
  >),
};

/** True when guests see the current revision of every block (04's "translations done"). */
export function allBlocksPublished(
  blocks: readonly Pick<WizardBlockFact, 'revision' | 'publishedRevision'>[],
) {
  return blocks.every((b) => b.publishedRevision === b.revision);
}

export interface GoLiveCheck {
  ready: boolean;
  missing: GoLiveItem[];
}

export function goLiveCheck(facts: WizardFacts): GoLiveCheck {
  const missing = GO_LIVE_ITEMS.filter((item) => {
    if (item === 'approval') return !facts.approved;
    if (item === 'translations') return !allBlocksPublished(facts.blocks);
    return !isFilled(item, facts);
  });
  return { ready: missing.length === 0, missing };
}

/** The wizard's input from a merged unit; inheritance is already applied. */
export function wizardFacts(e: EffectiveUnit): WizardFacts {
  return {
    propertyType: e.propertyType,
    approved: e.approvedAt !== null,
    live: e.qrSlug !== null,
    values: {
      addressLine: e.addressLine,
      city: e.city,
      postalCode: e.postalCode,
      location: e.location !== null,
      buildingDoorCode: e.buildingDoorCode,
      checkInTime: e.checkInTime,
      checkoutTime: e.checkoutTime,
      checkInMethod: e.checkInMethod,
      accessInstructions: e.accessInstructions,
      parkingType: e.parkingType,
      parkingNotes: e.parkingNotes,
      petsAllowed: e.petsAllowed,
      smokingAllowed: e.smokingAllowed,
      partiesAllowed: e.partiesAllowed,
      quietHoursFrom: e.quietHoursFrom,
      quietHoursTo: e.quietHoursTo,
      houseRulesNotes: e.houseRulesNotes,
      hostPhone: e.hostPhone,
      emergencyContactName: e.emergencyContactName,
      emergencyContactPhone: e.emergencyContactPhone,
      licenceNumber: e.licenceNumber,
      noWifi: e.noWifi,
      wifiNetwork: e.wifiNetwork,
      wifiPassword: e.wifiPassword,
      doorCode: e.doorCode,
      lockboxCode: e.lockboxCode,
      maxOccupancy: e.maxOccupancy,
      bedrooms: e.bedrooms,
      bathrooms: e.bathrooms,
      beds: e.beds,
      arrivalReleaseDaysBefore: e.arrivalReleaseDaysBefore,
    },
    amenityCount: e.amenities.length,
    blocks: e.blocks.map((b) => ({
      wizardKey: b.wizardKey,
      revision: b.revision,
      publishedRevision: b.publishedRevision,
    })),
  };
}
