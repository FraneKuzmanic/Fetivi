// Pure WizardFacts builders for the wizard unit tests.
import type { WizardFacts } from './completeness';
import type { WizardValues } from './wizard-config';

export function emptyValues(): WizardValues {
  return {
    addressLine: null,
    city: null,
    postalCode: null,
    location: false,
    buildingDoorCode: null,
    checkInTime: null,
    checkoutTime: null,
    checkInMethod: null,
    accessInstructions: null,
    parkingType: null,
    parkingNotes: null,
    petsAllowed: null,
    smokingAllowed: null,
    partiesAllowed: null,
    quietHoursFrom: null,
    quietHoursTo: null,
    houseRulesNotes: null,
    hostPhone: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    licenceNumber: null,
    noWifi: false,
    wifiNetwork: null,
    wifiPassword: null,
    doorCode: null,
    lockboxCode: null,
    maxOccupancy: null,
    bedrooms: null,
    bathrooms: null,
    beds: [],
    arrivalReleaseDaysBefore: 1,
  };
}

/** Just the go-live field minimum. */
export const MINIMUM: Partial<WizardValues> = {
  addressLine: 'Obala 1',
  city: 'Trogir',
  checkInTime: '15:00:00',
  checkInMethod: 'lockbox',
  accessInstructions: 'Key box left of the gate.',
  checkoutTime: '10:00:00',
  noWifi: true,
  hostPhone: '+385 91 000 0000',
};

export function facts(
  values: Partial<WizardValues> = {},
  overrides: Partial<Omit<WizardFacts, 'values'>> = {},
): WizardFacts {
  return {
    propertyType: null,
    approved: false,
    live: false,
    values: { ...emptyValues(), ...values },
    amenityCount: 0,
    blocks: [],
    ...overrides,
  };
}
