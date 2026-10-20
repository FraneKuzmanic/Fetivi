import {
  AMENITIES,
  assertValidZone,
  BED_TYPES,
  BLOCK_VISIBILITY,
  CHECK_IN_METHODS,
  HOST_BLOCK_CATEGORIES,
  type HostBlockCategory,
  LIMITS,
  PARKING_TYPES,
  stripMarkdownHtml,
  stripMarkup,
} from '@fetivi/domain';
import { z } from 'zod';

// Every host string is stripped of markup and control characters before its length is checked
// (architecture §4.3). Strict objects: a body can never carry hostId, approvedAt, qrSlug or revision.

/** A required single-line string, such as a name or title. */
const line = (max: number) =>
  z
    .string()
    .transform((s) => stripMarkup(s, { singleLine: true }))
    .pipe(z.string().min(1).max(max));

/** An optional string; empty after stripping means null (cleared). */
const optionalText = (max: number, options: { singleLine?: boolean } = {}) =>
  z
    .string()
    .transform((s) => stripMarkup(s, options))
    .pipe(z.string().max(max))
    .transform((s) => (s === '' ? null : s))
    .nullable();

const optionalLine = (max: number) => optionalText(max, { singleLine: true });

const PHONE = /^\+?[0-9 ()/-]{6,32}$/;
const phone = z
  .string()
  .transform((s) => stripMarkup(s, { singleLine: true }))
  .pipe(z.union([z.literal(''), z.string().max(LIMITS.phone).regex(PHONE)]))
  .transform((s) => (s === '' ? null : s))
  .nullable();

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const hhmm = z.string().regex(HHMM).nullable();

/** An IANA region name such as Europe/Zagreb; Luxon alone also accepts offsets like +01:00 and EST. */
const REGION_ZONE = /^[A-Z][A-Za-z_]+(\/[A-Z][A-Za-z0-9_+-]*)+$/;

const zone = z.string().refine((value) => {
  if (!REGION_ZONE.test(value)) return false;
  try {
    assertValidZone(value);
    return true;
  } catch {
    return false;
  }
});

const latLng = z
  .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
  .nullable();

const coreFields = {
  checkInTime: hhmm,
  checkoutTime: hhmm,
  checkInMethod: z.enum(CHECK_IN_METHODS).nullable(),
  accessInstructions: optionalText(LIMITS.longText),
  parkingType: z.enum(PARKING_TYPES).nullable(),
  parkingNotes: optionalText(LIMITS.longText),
  petsAllowed: z.boolean().nullable(),
  smokingAllowed: z.boolean().nullable(),
  partiesAllowed: z.boolean().nullable(),
  quietHoursFrom: hhmm,
  quietHoursTo: hhmm,
  houseRulesNotes: optionalText(LIMITS.longText),
  hostPhone: phone,
  emergencyContactName: optionalLine(LIMITS.shortText),
  emergencyContactPhone: phone,
  licenceNumber: optionalLine(LIMITS.licence),
};

const propertyFields = z.strictObject({
  name: line(LIMITS.name),
  addressLine: optionalLine(LIMITS.shortText),
  city: optionalLine(LIMITS.shortText),
  postalCode: optionalLine(LIMITS.shortText),
  country: z
    .string()
    .transform((s) => s.trim().toUpperCase())
    .pipe(z.string().regex(/^[A-Z]{2}$/)),
  location: latLng,
  timezone: zone,
  buildingDoorCode: optionalLine(LIMITS.code),
  ...coreFields,
});

export const PropertyCreate = propertyFields.partial().required({ name: true });
export const PropertyPatch = propertyFields.partial();
export type PropertyInput = z.infer<typeof PropertyPatch>;

const unitFields = z.strictObject({
  name: line(LIMITS.name),
  ...coreFields,
  noWifi: z.boolean(),
  wifiNetwork: optionalLine(LIMITS.shortText),
  wifiPassword: optionalLine(LIMITS.wifiPassword),
  doorCode: optionalLine(LIMITS.code),
  lockboxCode: optionalLine(LIMITS.code),
  maxOccupancy: z.number().int().min(1).max(50).nullable(),
  bedrooms: z.number().int().min(0).max(50).nullable(),
  beds: z
    .array(z.strictObject({ type: z.enum(BED_TYPES), count: z.number().int().min(1).max(20) }))
    .max(10),
  bathrooms: z.number().int().min(0).max(50).nullable(),
  arrivalReleaseDaysBefore: z.number().int().min(0).max(7),
});

export const UnitCreate = z.strictObject({ name: line(LIMITS.name) });
export const UnitPatch = unitFields.partial();

export const AmenitiesBody = z.strictObject({
  amenities: z
    .array(
      z.strictObject({
        amenity: z.enum(AMENITIES),
        note: optionalLine(LIMITS.amenityNote).optional(),
      }),
    )
    .max(AMENITIES.length)
    .refine((list) => new Set(list.map((a) => a.amenity)).size === list.length),
});

export const HiddenBlocksBody = z.strictObject({
  blockIds: z
    .array(z.uuid())
    .max(LIMITS.blocksPerOwner)
    .transform((ids) => [...new Set(ids)]),
});

const blockFields = {
  category: z.enum(HOST_BLOCK_CATEGORIES as [HostBlockCategory, ...HostBlockCategory[]]),
  title: line(LIMITS.title),
  body: z.string().transform(stripMarkdownHtml).pipe(z.string().min(1).max(LIMITS.blockBody)),
  visibility: z.enum(BLOCK_VISIBILITY),
  position: z.number().int().min(0).max(10_000),
};

export const BlockCreate = z
  .strictObject(blockFields)
  .partial({ visibility: true, position: true });
export const UnitBlockCreate = BlockCreate.extend({
  replacesBlockId: z.uuid().nullable().optional(),
});
export const BlockPatch = z.strictObject(blockFields).partial();

/** A host's own translation of one language; same transforms and limits as the block itself. */
export const TranslationCorrection = z.strictObject({
  revision: z.number().int().min(1),
  title: blockFields.title,
  body: blockFields.body,
});
