import type { StayRow } from '../db/schema/stays';
import type { BlockTranslationRow } from '../db/schema/translations';
import type { EffectiveUnit } from '../property/effective';
import type {
  Amenity,
  Bed,
  BlockCategory,
  CheckInMethod,
  GuestLanguage,
  ParkingType,
} from '../property/vocabulary';
import type { CivilDate } from '../time';

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
    checkIn: CivilDate;
    checkout: CivilDate;
    partySize: number;
    arrivalDetailsReleased: boolean;
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
  blocks: { category: BlockCategory; title: string; body: string }[];
}

export interface ProjectionInput {
  unit: EffectiveUnit;
  stay: Pick<StayRow, 'checkIn' | 'checkout' | 'partySize' | 'arrivalReleaseAt'>;
  language: GuestLanguage;
  /** block_translations rows at each block's published revision, any language. */
  translations: Pick<BlockTranslationRow, 'blockId' | 'revision' | 'language' | 'title' | 'body'>[];
  now: Date;
}

/**
 * Built as an explicit allow-list, never by spreading the unit: ids, the QR slug, the licence,
 * approval and inheritance data, block revisions and every host-only Stay column stay out.
 * Arrival details, the six typed secrets and `after_release` blocks appear from the release time.
 * Block text comes only from the published revision's translation, never from the block row,
 * which may hold an unpublished newer revision.
 */
export function guestProjection(input: ProjectionInput): GuestProjection {
  const { unit: u, stay, language, now } = input;
  const released = now >= stay.arrivalReleaseAt;
  const secret = <T>(value: T): T | null => (released ? value : null);

  const texts = new Map<string, { title: string; body: string }>();
  for (const t of input.translations) {
    if (t.language === language) texts.set(`${t.blockId}:${t.revision}`, t);
  }
  const blocks: GuestProjection['blocks'] = [];
  for (const b of u.blocks) {
    if (b.publishedRevision === null) continue;
    if (b.visibility === 'after_release' && !released) continue;
    const text = texts.get(`${b.id}:${b.publishedRevision}`);
    if (!text) continue;
    blocks.push({ category: b.category, title: text.title, body: text.body });
  }

  return {
    language,
    property: {
      name: u.propertyName,
      addressLine: u.addressLine,
      city: u.city,
      postalCode: u.postalCode,
      country: u.country,
      timezone: u.timezone,
      location: u.location ? { lat: u.location.y, lng: u.location.x } : null,
    },
    unit: {
      name: u.unitName,
      maxOccupancy: u.maxOccupancy,
      bedrooms: u.bedrooms,
      beds: u.beds.map((b) => ({ type: b.type, count: b.count })),
      bathrooms: u.bathrooms,
    },
    stay: {
      checkIn: stay.checkIn,
      checkout: stay.checkout,
      partySize: stay.partySize,
      arrivalDetailsReleased: released,
      arrivalDetailsReleaseAt: stay.arrivalReleaseAt.toISOString(),
    },
    checkInOut: {
      checkInTime: u.checkInTime,
      checkoutTime: u.checkoutTime,
      checkInMethod: u.checkInMethod,
    },
    arrival: released
      ? {
          accessInstructions: u.accessInstructions,
          buildingDoorCode: u.buildingDoorCode,
          doorCode: u.doorCode,
          lockboxCode: u.lockboxCode,
        }
      : null,
    wifi: u.noWifi ? null : { network: u.wifiNetwork, password: secret(u.wifiPassword) },
    parking: { type: u.parkingType, notes: u.parkingNotes },
    houseRules: {
      petsAllowed: u.petsAllowed,
      smokingAllowed: u.smokingAllowed,
      partiesAllowed: u.partiesAllowed,
      quietHoursFrom: u.quietHoursFrom,
      quietHoursTo: u.quietHoursTo,
      notes: u.houseRulesNotes,
    },
    contacts: {
      hostPhone: secret(u.hostPhone),
      emergencyContactName: u.emergencyContactName,
      emergencyContactPhone: secret(u.emergencyContactPhone),
    },
    amenities: u.amenities.map((a) => ({ amenity: a.amenity, note: a.note })),
    blocks,
  };
}
