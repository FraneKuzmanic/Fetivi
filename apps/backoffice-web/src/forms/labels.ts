import type {
  CatalogKind,
  ImageSource,
  PlaceCategory,
  SourceField,
  StalenessStatus,
  TransportMode,
} from '@fetivi/domain/catalog-vocabulary';
import type {
  CurationAction,
  CurationKind,
  CurationStatus,
} from '@fetivi/domain/curation-vocabulary';
import type { DraftingTaskStatus } from '@fetivi/domain/drafting-vocabulary';
import type { AnswerTopic, FeedbackReason } from '@fetivi/domain/feedback-vocabulary';
import type {
  AdapterKind,
  AvailabilityMode,
  ContactFields,
  OfferCategory,
  OrderKind,
  PaymentMode,
  PriceUnit,
  ProviderLanguage,
} from '@fetivi/domain/offer-vocabulary';
import {
  type SeedingSource,
  SOURCE_LABELS,
  type SourceFailure,
} from '@fetivi/domain/seeding-vocabulary';
import type {
  Amenity,
  BedType,
  BlockCategory,
  BlockVisibility,
  CheckInMethod,
  GuestLanguage,
  ParkingType,
  PropertyType,
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
  host_picks: 'Neighbourhood tips',
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

export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  apartment: 'Apartment',
  studio: 'Studio',
  house: 'House',
  villa: 'Villa',
  room: 'Room',
  guesthouse: 'Guesthouse',
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

export const CATALOG_KIND_LABELS: Record<CatalogKind, string> = {
  place: 'Place',
  event: 'Event',
  transport_note: 'Transport note',
  day_trip: 'Day trip',
};

export const PLACE_CATEGORY_LABELS: Record<PlaceCategory, string> = {
  beach: 'Beach',
  restaurant: 'Restaurant',
  cafe_bar: 'Café or bar',
  sight: 'Sight',
  nature: 'Nature',
  activity: 'Activity',
  shop: 'Shop',
  nightlife: 'Nightlife',
};

/** What guests' answers were about, as host and admin stats count them (43). */
export const ANSWER_TOPIC_LABELS: Record<AnswerTopic, string> = {
  arrival: 'Arrival and access',
  wifi: 'Wi-Fi',
  checkout: 'Checkout and house rules',
  contacts: 'Contacts',
  places: 'Places (any)',
  beach: PLACE_CATEGORY_LABELS.beach,
  restaurant: PLACE_CATEGORY_LABELS.restaurant,
  cafe_bar: PLACE_CATEGORY_LABELS.cafe_bar,
  sight: PLACE_CATEGORY_LABELS.sight,
  nature: PLACE_CATEGORY_LABELS.nature,
  activity: PLACE_CATEGORY_LABELS.activity,
  shop: PLACE_CATEGORY_LABELS.shop,
  nightlife: PLACE_CATEGORY_LABELS.nightlife,
  day_trip: 'Day trips',
  host_picks: 'Your picks',
  events: 'Events',
  weather: 'Weather',
  transport: 'Getting around',
  web_search: 'Web search',
  services: 'Booking services',
  orders: 'Their orders',
  host_message: 'Messages to you',
  plan: 'Day plans',
  about_me: 'About me',
  general: 'General chat',
};

export const FEEDBACK_REASON_LABELS: Record<FeedbackReason, string> = {
  wrong: 'Wrong',
  outdated: 'Outdated',
  not_helpful: 'Not helpful',
};

export const TRANSPORT_MODE_LABELS: Record<TransportMode, string> = {
  ferry: 'Ferry',
  catamaran: 'Catamaran',
  bus: 'Bus',
  boat_taxi: 'Boat taxi',
  taxi: 'Taxi',
  train: 'Train',
  other: 'Other',
};

export const IMAGE_SOURCE_LABELS: Record<ImageSource, string> = {
  own_photo: 'Own photo',
  venue_permission: 'Venue photo (with permission)',
  wikimedia_commons: 'Wikimedia Commons',
};

export const STALENESS_LABELS: Record<StalenessStatus, string> = {
  fresh: 'Fresh',
  stale: 'Past its budget',
  never_verified: 'Never verified',
  expired: 'Ended',
};

export const SOURCE_FIELD_LABELS: Record<SourceField, string> = {
  title: 'Title',
  description: 'Description',
  placeCategory: 'Category',
  location: 'Location',
  address: 'Address',
  phone: 'Phone',
  websiteUrl: 'Website',
  venueName: 'Venue',
  startsAt: 'Start',
  endsAt: 'End',
  transportMode: 'Mode',
  links: 'Links',
  travelMinutes: 'Travel time',
  seasons: 'Seasons',
  openingHours: 'Opening hours',
};

/** ISO weekdays, Monday first. */
export const WEEKDAY_LABELS: Record<number, string> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday',
};

export const ORDER_KIND_LABELS: Record<OrderKind, string> = {
  booking: 'Booking',
  ticket: 'Ticket',
  purchase: 'Purchase',
  request: 'Request',
};

/** The Offer's Category; not the place category. */
export const OFFER_CATEGORY_LABELS: Record<OfferCategory, string> = {
  tour: 'Tour',
  boat_trip: 'Boat trip',
  dining_experience: 'Dining experience',
  tasting: 'Tasting',
  transfer: 'Transfer',
  rental: 'Rental',
  class: 'Class or workshop',
  wellness: 'Wellness',
  goods: 'Goods',
  other: 'Other',
};

export const AVAILABILITY_MODE_LABELS: Record<AvailabilityMode, string> = {
  live: "Live (Provider's booking system)",
  allotment: 'Allotment (seats from the deal)',
  on_request: 'On request (Provider accepts)',
};

/** Short forms for chips and lists. */
export const AVAILABILITY_MODE_SHORT: Record<AvailabilityMode, string> = {
  live: 'Live',
  allotment: 'Allotment',
  on_request: 'On request',
};

export const PAYMENT_MODE_LABELS: Record<PaymentMode, string> = {
  direct: 'Pay the Provider directly',
  online: 'Pay online',
};

export const CONTACT_FIELDS_LABELS: Record<ContactFields, string> = {
  name: 'Name',
  phone: 'Phone',
  name_and_phone: 'Name and phone',
};

export const PROVIDER_LANGUAGE_LABELS: Record<ProviderLanguage, string> = {
  hr: 'Hrvatski',
  en: 'English',
};

export const PRICE_UNIT_LABELS: Record<PriceUnit, string> = {
  person: 'per person',
  group: 'per group',
  item: 'per item',
  litre: 'per litre',
  kilogram: 'per kg',
  hour: 'per hour',
  day: 'per day',
};

export const ADAPTER_KIND_LABELS: Record<AdapterKind, string> = {
  bokun: 'Bókun',
};

export const CURATION_KIND_LABELS: Record<CurationKind, string> = {
  draft: 'Draft',
  refresh_diff: 'Refresh diff',
  guest_flagged: 'Flagged by guests',
  host_place_suggestion: 'Host place suggestion',
  host_provider_suggestion: 'Host Provider suggestion',
  fallback_topic_cluster: 'Web fallback topic',
};

export const CURATION_ACTION_LABELS: Record<CurationAction, string> = {
  approve: 'Approve',
  edit: 'Edit',
  reject: 'Reject',
  needs_visit: 'Needs a visit',
};

export const CURATION_STATUS_LABELS: Record<CurationStatus, string> = {
  open: 'Open',
  needs_visit: 'Needs a visit',
  approved: 'Approved',
  rejected: 'Rejected',
};

export const SEEDING_SOURCE_LABELS: Record<SeedingSource, string> = SOURCE_LABELS;

export const SEEDING_FAILURE_LABELS: Record<SourceFailure, string> = {
  unavailable: 'did not answer',
  'unexpected-response': 'answered in an unexpected format',
  'too-large': 'returned too much for one import',
};

export const DRAFTING_TASK_STATUS_LABELS: Record<DraftingTaskStatus, string> = {
  queued: 'Queued',
  drafted: 'Drafted',
  diffed: 'Changes found',
  unchanged: 'No changes',
  no_sources: 'No usable source',
  failed: 'Failed',
};
