import type {
  Amenity,
  BedType,
  BlockCategory,
  BlockVisibility,
  CheckInMethod,
  GuestLanguage,
  ParkingType,
  SharedCoreField,
  TranslationError,
  TranslationOrigin,
  TranslationStatus,
} from '@fetivi/domain/vocabulary';

export const AMENITY_LABELS: Record<Amenity, string> = {
  ac: 'Air conditioning',
  airport_shuttle: 'Airport shuttle',
  balcony: 'Balcony',
  beach_access: 'Beach access',
  child_friendly: 'Child friendly',
  crib: 'Crib',
  elevator: 'Elevator',
  fireplace: 'Fireplace',
  free_breakfast: 'Free breakfast',
  gym: 'Gym',
  heating: 'Heating',
  hot_tub: 'Hot tub',
  ironing_board: 'Iron and ironing board',
  kitchen: 'Kitchen',
  microwave: 'Microwave',
  outdoor_grill: 'Outdoor grill',
  oven_stove: 'Oven and stove',
  patio: 'Patio',
  pets_allowed: 'Pets allowed',
  pool: 'Pool',
  private_beach_access: 'Private beach access',
  self_check_in: 'Self check-in',
  smoking_allowed: 'Smoking allowed',
  tv: 'TV',
  washer: 'Washing machine',
  dryer: 'Dryer',
  dishwasher: 'Dishwasher',
  wheelchair_accessible: 'Wheelchair accessible',
  wifi: 'Wi-Fi',
  hair_dryer: 'Hair dryer',
  coffee_maker: 'Coffee maker',
  sea_view: 'Sea view',
};

/** The Guide section names. */
export const CATEGORY_LABELS: Record<BlockCategory, string> = {
  arrival_access: 'Arrival and access',
  wifi_essentials: 'Wi-Fi and essentials',
  house_rules_checkout: 'House rules and checkout',
  how_tos: 'How-tos',
  saved_places: 'Saved places',
  host_picks: "Host's top picks / Neighbourhood tips",
  contacts_emergency: 'Contacts and emergency',
};

export const VISIBILITY_LABELS: Record<BlockVisibility, string> = {
  always: 'Always visible',
  after_release: 'From arrival release',
};

export const CHECK_IN_METHOD_LABELS: Record<CheckInMethod, string> = {
  smart_lock: 'Smart lock',
  keypad: 'Keypad',
  lockbox: 'Lockbox',
  building_staff: 'Building staff',
  in_person: 'In person',
  other: 'Other',
};

export const PARKING_LABELS: Record<ParkingType, string> = {
  none: 'No parking',
  free_on_site: 'Free on site',
  paid_on_site: 'Paid on site',
  free_street: 'Free street parking',
  paid_street: 'Paid street parking',
  public_garage: 'Public garage nearby',
};

export const BED_LABELS: Record<BedType, string> = {
  double: 'Double bed',
  single: 'Single bed',
  sofa_bed: 'Sofa bed',
  bunk: 'Bunk bed',
  crib: 'Crib',
};

export const CORE_FIELD_LABELS: Record<SharedCoreField, string> = {
  checkInTime: 'Check-in from',
  checkoutTime: 'Checkout by',
  checkInMethod: 'Check-in method',
  accessInstructions: 'Access instructions',
  parkingType: 'Parking',
  parkingNotes: 'Parking notes',
  petsAllowed: 'Pets allowed',
  smokingAllowed: 'Smoking allowed',
  partiesAllowed: 'Parties allowed',
  quietHoursFrom: 'Quiet hours from',
  quietHoursTo: 'Quiet hours until',
  houseRulesNotes: 'Other house rules',
  hostPhone: 'Host phone',
  emergencyContactName: 'Emergency contact name',
  emergencyContactPhone: 'Emergency contact phone',
  licenceNumber: 'Licence number',
};

/** Guest languages under their English names; the host UI is English. */
export const LANGUAGE_LABELS: Record<GuestLanguage, string> = {
  en: 'English',
  hr: 'Croatian',
  de: 'German',
  it: 'Italian',
  pl: 'Polish',
  hu: 'Hungarian',
  fr: 'French',
};

export const TRANSLATION_STATUS_LABELS: Record<TranslationStatus, string> = {
  pending: 'Translating',
  published: 'Published',
  failed: 'Translation failed',
};

export const TRANSLATION_ERROR_LABELS: Record<TranslationError, string> = {
  'structure-mismatch':
    "Some languages did not keep the text's structure (headings, lists, links or placeholders). Correct them below or retry.",
  'model-error': 'The translation service did not answer. Retry in a moment.',
  'not-configured': 'Translation is not set up on this server.',
};

export const TRANSLATION_ORIGIN_LABELS: Record<TranslationOrigin, string> = {
  source: 'Original',
  machine: 'Machine',
  host: 'Your correction',
};
