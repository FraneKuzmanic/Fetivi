// Every controlled list of the property model. Imports nothing: the back-office SPA bundles
// this file through the `@fetivi/domain/vocabulary` subpath, and the pgEnums are built from it.

/** The seven Guide sections, one to one. Hosts write blocks in all but saved_places. */
export const BLOCK_CATEGORIES = [
  'arrival_access',
  'wifi_essentials',
  'house_rules_checkout',
  'how_tos',
  'saved_places',
  'host_picks',
  'contacts_emergency',
] as const;
export type BlockCategory = (typeof BLOCK_CATEGORIES)[number];

export type HostBlockCategory = Exclude<BlockCategory, 'saved_places'>;
/** host_picks holds the Neighbourhood tips block until catalog picks arrive. */
export const HOST_BLOCK_CATEGORIES = BLOCK_CATEGORIES.filter(
  (c): c is HostBlockCategory => c !== 'saved_places',
);

/** after_release: time-gated arrival content, shown from the unit's arrival release time. */
export const BLOCK_VISIBILITY = ['always', 'after_release'] as const;
export type BlockVisibility = (typeof BLOCK_VISIBILITY)[number];

/** Airbnb's check-in methods. */
export const CHECK_IN_METHODS = [
  'smart_lock',
  'keypad',
  'lockbox',
  'building_staff',
  'in_person',
  'other',
] as const;
export type CheckInMethod = (typeof CHECK_IN_METHODS)[number];

export const PARKING_TYPES = [
  'none',
  'free_on_site',
  'paid_on_site',
  'free_street',
  'paid_street',
  'public_garage',
] as const;
export type ParkingType = (typeof PARKING_TYPES)[number];

/** What kind of place the host rents. Drives which setup wizard questions are asked (ticket 20). */
export const PROPERTY_TYPES = [
  'apartment',
  'studio',
  'house',
  'villa',
  'room',
  'guesthouse',
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export const BED_TYPES = ['double', 'single', 'sofa_bed', 'bunk', 'crib'] as const;
export type BedType = (typeof BED_TYPES)[number];
export interface Bed {
  type: BedType;
  count: number;
}

/** Google VacationRental amenity names (booleans), minus booking-only ones. */
export const AMENITIES = [
  'ac',
  'airport_shuttle',
  'balcony',
  'beach_access',
  'child_friendly',
  'crib',
  'elevator',
  'fireplace',
  'free_breakfast',
  'gym',
  'heating',
  'hot_tub',
  'ironing_board',
  'kitchen',
  'microwave',
  'outdoor_grill',
  'oven_stove',
  'patio',
  'pets_allowed',
  'pool',
  'private_beach_access',
  'self_check_in',
  'smoking_allowed',
  'tv',
  'washer',
  'dryer',
  'dishwasher',
  'wheelchair_accessible',
  'wifi',
  'hair_dryer',
  'coffee_maker',
  'sea_view',
] as const;
export type Amenity = (typeof AMENITIES)[number];

/** Core fields a property sets and a unit may override; null on a unit means "inherit". */
export const SHARED_CORE_FIELDS = [
  'checkInTime',
  'checkoutTime',
  'checkInMethod',
  'accessInstructions',
  'parkingType',
  'parkingNotes',
  'petsAllowed',
  'smokingAllowed',
  'partiesAllowed',
  'quietHoursFrom',
  'quietHoursTo',
  'houseRulesNotes',
  'hostPhone',
  'emergencyContactName',
  'emergencyContactPhone',
  'licenceNumber',
] as const;
export type SharedCoreField = (typeof SHARED_CORE_FIELDS)[number];

/** Maximum lengths of host input, in characters (after markup stripping). */
export const LIMITS = {
  name: 120,
  title: 120,
  /** Addresses, Wi-Fi network, contact names. */
  shortText: 200,
  /** Access instructions, notes. */
  longText: 2000,
  blockBody: 5000,
  phone: 32,
  code: 64,
  wifiPassword: 128,
  licence: 64,
  amenityNote: 200,
  blocksPerOwner: 100,
  /** Block media caption, also its alt text. */
  caption: 200,
  mediaPerBlock: 6,
  imageBytes: 10 * 1024 * 1024,
  videoBytes: 50 * 1024 * 1024,
  /** House manual import: the uploaded file, the extracted text, and the blocks one import may propose. */
  manualBytes: 10 * 1024 * 1024,
  manualText: 60_000,
  manualBlocks: 40,
} as const;

/** Photos and short videos on an Info block. */
export const MEDIA_KINDS = ['image', 'video'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/** Accepted upload types, by sniffed content, with the file extension each is stored under. */
export const MEDIA_TYPES = {
  'image/jpeg': { kind: 'image', ext: 'jpg' },
  'image/png': { kind: 'image', ext: 'png' },
  'image/webp': { kind: 'image', ext: 'webp' },
  'video/mp4': { kind: 'video', ext: 'mp4' },
  'video/webm': { kind: 'video', ext: 'webm' },
} as const satisfies Record<string, { kind: MediaKind; ext: string }>;
export type MediaContentType = keyof typeof MEDIA_TYPES;
export const MEDIA_CONTENT_TYPES = Object.keys(MEDIA_TYPES) as MediaContentType[];

/** Guest languages, in the PRD's order. Also the order of the language picker. */
export const GUEST_LANGUAGES = ['en', 'hr', 'de', 'it', 'pl', 'hu', 'fr'] as const;
export type GuestLanguage = (typeof GUEST_LANGUAGES)[number];

/** The language a block is written in: a guest language, or 'other'. */
export const SOURCE_LANGUAGES = [...GUEST_LANGUAGES, 'other'] as const;
export type SourceLanguage = (typeof SOURCE_LANGUAGES)[number];

/** 'source' is the host's own text; 'machine' the job's; 'host' a host correction. */
export const TRANSLATION_ORIGINS = ['source', 'machine', 'host'] as const;
export type TranslationOrigin = (typeof TRANSLATION_ORIGINS)[number];

/** Of a block's current revision. Published means guests see the current revision. */
export const TRANSLATION_STATUSES = ['pending', 'published', 'failed'] as const;
export type TranslationStatus = (typeof TRANSLATION_STATUSES)[number];

export const TRANSLATION_ERRORS = ['structure-mismatch', 'model-error', 'not-configured'] as const;
export type TranslationError = (typeof TRANSLATION_ERRORS)[number];

/** Where a house manual import came from. */
export const MANUAL_SOURCES = ['paste', 'pdf', 'docx', 'txt'] as const;
export type ManualSource = (typeof MANUAL_SOURCES)[number];

/** A house manual draft: pending until the host confirms or dismisses it. */
export type DraftStatus = 'pending' | 'confirmed' | 'dismissed';
