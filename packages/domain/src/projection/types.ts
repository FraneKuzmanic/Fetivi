// The guest projection's shape. Imports only the vocabulary, so browser code can import the type
// through `@fetivi/domain/projection-types` without pulling in server modules.
import type {
  Amenity,
  Bed,
  BlockCategory,
  CheckInMethod,
  GuestLanguage,
  MediaKind,
  ParkingType,
} from '../property/vocabulary';

/** The part of a unit's record a guest may see at one instant, in the guest's language. */
export interface GuestProjection {
  language: GuestLanguage;
  property: {
    name: string;
    addressLine: string | null;
    city: string | null;
    postalCode: string | null;
    country: string;
    timezone: string;
    location: { lat: number; lng: number } | null;
  };
  unit: {
    name: string;
    maxOccupancy: number | null;
    bedrooms: number | null;
    beds: Bed[];
    bathrooms: number | null;
  };
  stay: {
    /** 'YYYY-MM-DD' at the property. */
    checkIn: string;
    checkout: string;
    partySize: number;
    arrivalDetailsReleased: boolean;
    /**
     * True before the release when at least one gated item has a value, so the Guide can say details
     * are coming. Never says which item or what it holds; false once released.
     */
    arrivalDetailsPending: boolean;
    /** ISO instant. */
    arrivalDetailsReleaseAt: string;
  };
  checkInOut: {
    checkInTime: string | null;
    checkoutTime: string | null;
    checkInMethod: CheckInMethod | null;
  };
  /** Null until the release time. */
  arrival: {
    accessInstructions: string | null;
    buildingDoorCode: string | null;
    doorCode: string | null;
    lockboxCode: string | null;
  } | null;
  /** Null when the unit has no Wi-Fi; the password is null until the release time. */
  wifi: { network: string | null; password: string | null } | null;
  parking: { type: ParkingType | null; notes: string | null };
  houseRules: {
    petsAllowed: boolean | null;
    smokingAllowed: boolean | null;
    partiesAllowed: boolean | null;
    quietHoursFrom: string | null;
    quietHoursTo: string | null;
    notes: string | null;
  };
  /** Phones are typed secrets: null until the release time. */
  contacts: {
    hostPhone: string | null;
    emergencyContactName: string | null;
    emergencyContactPhone: string | null;
  };
  amenities: { amenity: Amenity; note: string | null }[];
  /** Published blocks in the guest's language; `after_release` blocks only once released. */
  blocks: {
    category: BlockCategory;
    title: string;
    body: string;
    /** Media of the published revision; the id is what guests fetch the file by. */
    media: { id: string; kind: MediaKind; caption: string }[];
  }[];
}
