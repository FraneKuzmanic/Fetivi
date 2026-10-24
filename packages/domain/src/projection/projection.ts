import type { BlockMediaRow } from '../db/schema/block-media';
import type { StayRow } from '../db/schema/stays';
import type { BlockTranslationRow } from '../db/schema/translations';
import type { EffectiveUnit } from '../property/effective';
import type { GuestLanguage } from '../property/vocabulary';
import type { GuestProjection } from './types';

export type { GuestProjection } from './types';

export interface ProjectionInput {
  unit: EffectiveUnit;
  stay: Pick<StayRow, 'checkIn' | 'checkout' | 'partySize' | 'arrivalReleaseAt'>;
  language: GuestLanguage;
  /** block_translations rows at each block's published revision, any language. */
  translations: Pick<
    BlockTranslationRow,
    'blockId' | 'revision' | 'language' | 'title' | 'body' | 'captions'
  >[];
  /** block_media rows of the published blocks. */
  media: Pick<
    BlockMediaRow,
    'id' | 'blockId' | 'kind' | 'caption' | 'addedRevision' | 'position' | 'createdAt'
  >[];
  now: Date;
}

/**
 * Built as an explicit allow-list, never by spreading the unit: ids, the QR slug, the licence,
 * approval and inheritance data, block revisions and every host-only Stay column stay out.
 * Arrival details, the six typed secrets and `after_release` blocks appear from the release time.
 * Block text comes only from the published revision's translation, never from the block row,
 * which may hold an unpublished newer revision. Media appear with the publication of the revision
 * that added them; their ids are the only ids the projection carries. Before the release it says
 * only whether something is held back, never what.
 */
export function guestProjection(input: ProjectionInput): GuestProjection {
  const { unit: u, stay, language, now } = input;
  const released = now >= stay.arrivalReleaseAt;
  // Every gated value goes through `secret`, so the held-back check below cannot miss one.
  const gatedValues: (string | null)[] = [];
  const secret = (value: string | null): string | null => {
    gatedValues.push(value);
    return released ? value : null;
  };

  const texts = new Map<string, ProjectionInput['translations'][number]>();
  for (const t of input.translations) {
    if (t.language === language) texts.set(`${t.blockId}:${t.revision}`, t);
  }
  const blocks: GuestProjection['blocks'] = [];
  let blockHeldBack = false;
  for (const b of u.blocks) {
    if (b.publishedRevision === null) continue;
    const text = texts.get(`${b.id}:${b.publishedRevision}`);
    if (!text) continue;
    // Checked after the translation lookup so only a block that would appear at the release counts.
    if (b.visibility === 'after_release' && !released) {
      blockHeldBack = true;
      continue;
    }
    const published = b.publishedRevision;
    const media = input.media
      .filter((m) => m.blockId === b.id && m.addedRevision <= published)
      .sort((x, y) => x.position - y.position || x.createdAt.getTime() - y.createdAt.getTime())
      .map((m) => ({ id: m.id, kind: m.kind, caption: text.captions[m.id] ?? m.caption }));
    blocks.push({ category: b.category, title: text.title, body: text.body, media });
  }

  const arrival = {
    accessInstructions: secret(u.accessInstructions),
    buildingDoorCode: secret(u.buildingDoorCode),
    doorCode: secret(u.doorCode),
    lockboxCode: secret(u.lockboxCode),
  };
  // A noWifi unit never shows its password, so a stored one is not held back.
  const wifi = u.noWifi ? null : { network: u.wifiNetwork, password: secret(u.wifiPassword) };
  const contacts = {
    hostPhone: secret(u.hostPhone),
    emergencyContactName: u.emergencyContactName,
    emergencyContactPhone: secret(u.emergencyContactPhone),
  };
  const heldBack =
    !released && (blockHeldBack || gatedValues.some((v) => v !== null && v.trim() !== ''));

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
      arrivalDetailsHeldBack: heldBack,
      arrivalDetailsReleaseAt: stay.arrivalReleaseAt.toISOString(),
    },
    checkInOut: {
      checkInTime: u.checkInTime,
      checkoutTime: u.checkoutTime,
      checkInMethod: u.checkInMethod,
    },
    arrival: released ? arrival : null,
    wifi,
    parking: { type: u.parkingType, notes: u.parkingNotes },
    houseRules: {
      petsAllowed: u.petsAllowed,
      smokingAllowed: u.smokingAllowed,
      partiesAllowed: u.partiesAllowed,
      quietHoursFrom: u.quietHoursFrom,
      quietHoursTo: u.quietHoursTo,
      notes: u.houseRulesNotes,
    },
    contacts,
    amenities: u.amenities.map((a) => ({ amenity: a.amenity, note: a.note })),
    blocks,
  };
}
