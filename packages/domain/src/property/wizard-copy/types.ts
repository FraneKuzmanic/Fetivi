import type { GoLiveItem } from '../go-live';
import type {
  Amenity,
  BedType,
  CheckInMethod,
  GuestLanguage,
  ParkingType,
  PropertyType,
} from '../vocabulary';
import type { WizardFieldId, WizardLevel, WizardPromptKey, WizardStepId } from '../wizard-config';

/**
 * Every string the setup wizard shows, in one language. Placeholders are `{name}`. A missing key
 * is a type error, so all seven languages stay complete.
 */
export interface WizardCopy {
  steps: Record<WizardStepId, { title: string; intro: string }>;
  fields: Record<WizardFieldId, { label: string; why: string; example: string }>;
  prompts: Record<WizardPromptKey, { defaultTitle: string; bodyPlaceholder: string }>;
  levels: Record<WizardLevel, string>;
  propertyTypes: Record<PropertyType, { label: string; hint: string }>;
  checkInMethods: Record<CheckInMethod, string>;
  parkingTypes: Record<ParkingType, string>;
  bedTypes: Record<BedType, string>;
  amenities: Record<Amenity, string>;
  /** Each language under its own name, for the picker. */
  languages: Record<GuestLanguage, string>;
  goLive: Record<GoLiveItem, string> & {
    title: string;
    ready: string;
    notReady: string;
    live: string;
    button: string;
    noLongerMet: string;
    waitingApproval: string;
    translationsPending: string;
    openQr: string;
  };
  ui: {
    setup: string;
    /** {unit} */
    overviewTitle: string;
    overviewIntro: string;
    /** {n}, {total} */
    stepOf: string;
    steps: string;
    overview: string;
    back: string;
    saveContinue: string;
    saveExit: string;
    noFields: string;
    continueSetup: string;
    review: string;
    openWizard: string;
    why: string;
    example: string;
    /** {percent} */
    completeness: string;
    /** {filled}, {total} */
    completenessCount: string;
    chooseType: string;
    typeIntro: string;
    savedPlacesInfo: string;
    /** {property} */
    sharedHint: string;
    unitOnlyHint: string;
    stepDone: string;
    /** {n} */
    requiredLeft: string;
    /** {n} */
    recommendedLeft: string;
    bold: string;
    bulletList: string;
    numberedList: string;
    link: string;
    /** {n} */
    charactersLeft: string;
    yes: string;
    no: string;
    notSet: string;
    noWifi: string;
    wifiNetwork: string;
    wifiPassword: string;
    language: string;
    add: string;
    edit: string;
    cancel: string;
    save: string;
    added: string;
    notAdded: string;
    blockTitle: string;
    blockBody: string;
    addressLine: string;
    city: string;
    postalCode: string;
    latitude: string;
    longitude: string;
    parkingType: string;
    parkingNotes: string;
    pets: string;
    smoking: string;
    parties: string;
    quietFrom: string;
    quietTo: string;
    emergencyName: string;
    emergencyPhone: string;
    maxGuests: string;
    bedrooms: string;
    bathrooms: string;
    beds: string;
    bedType: string;
    bedCount: string;
    addBed: string;
    removeBed: string;
    releaseSameDay: string;
    releaseOneDay: string;
    /** {n} */
    releaseDays: string;
    amenityNote: string;
    fromProperty: string;
  };
}
