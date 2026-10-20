import {
  CATALOG_LIMITS,
  type CatalogKind,
  IMAGE_SOURCES,
  LIMITS,
  PLACE_CATEGORIES,
  SOURCE_FIELDS,
  stripMarkdownHtml,
  TRANSPORT_MODES,
} from '@fetivi/domain';
import { z } from 'zod';
import { HHMM, latLng, line, optionalLine, phone, zone } from '../properties/schemas';

// Admin input for destinations and catalog records. Same stripping and strict objects as host
// input: a body can never set revision, verifiedAt or the translation status.

export const httpsUrl = z
  .string()
  .trim()
  .max(CATALOG_LIMITS.url)
  .pipe(z.url({ protocol: /^https$/ }));

/** An optional https URL; empty means null (cleared). */
const optionalUrl = z
  .string()
  .trim()
  .max(CATALOG_LIMITS.url)
  .transform((s) => (s === '' ? null : s))
  .pipe(z.url({ protocol: /^https$/ }).nullable())
  .nullable();

const markdown = z
  .string()
  .transform(stripMarkdownHtml)
  .pipe(z.string().min(1).max(LIMITS.blockBody));

const point = latLng.unwrap();

export const DestinationCreate = z.strictObject({
  name: line(LIMITS.name),
  centre: point,
  radiusKm: z.number().min(CATALOG_LIMITS.radiusKmMin).max(CATALOG_LIMITS.radiusKmMax),
  timezone: zone.default('Europe/Zagreb'),
});
export const DestinationPatch = z
  .strictObject({
    name: line(LIMITS.name),
    centre: point,
    radiusKm: z.number().min(CATALOG_LIMITS.radiusKmMin).max(CATALOG_LIMITS.radiusKmMax),
    timezone: zone,
  })
  .partial();

/** Wall-clock time in the destination's zone, 'YYYY-MM-DDTHH:mm'. */
export const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

const fieldSourcesFor = <K extends CatalogKind>(kind: K) =>
  z.partialRecord(z.enum(SOURCE_FIELDS[kind]), httpsUrl);

const common = {
  title: line(LIMITS.title),
  description: markdown,
};

const link = z.strictObject({ label: line(LIMITS.title), url: httpsUrl });

/** Per kind: the fields of a create, with the optional ones marked. */
const placeFields = {
  ...common,
  placeCategory: z.enum(PLACE_CATEGORIES),
  location: point,
  address: optionalLine(LIMITS.shortText).optional(),
  phone: phone.optional(),
  websiteUrl: optionalUrl.optional(),
};
const eventFields = {
  ...common,
  startsAt: localDateTime,
  endsAt: localDateTime,
  location: latLng.optional(),
  venueName: optionalLine(LIMITS.shortText).optional(),
  websiteUrl: optionalUrl.optional(),
};
const transportFields = {
  ...common,
  transportMode: z.enum(TRANSPORT_MODES),
  links: z.array(link).max(CATALOG_LIMITS.linksPerNote).optional(),
};
const dayTripFields = {
  ...common,
  travelMinutes: z.number().int().min(1).max(CATALOG_LIMITS.travelMinutesMax),
  location: latLng.optional(),
  websiteUrl: optionalUrl.optional(),
};

export const RecordCreate = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('place'),
    ...placeFields,
    fieldSources: fieldSourcesFor('place').default({}),
  }),
  z.strictObject({
    kind: z.literal('event'),
    ...eventFields,
    fieldSources: fieldSourcesFor('event').default({}),
  }),
  z.strictObject({
    kind: z.literal('transport_note'),
    ...transportFields,
    fieldSources: fieldSourcesFor('transport_note').default({}),
  }),
  z.strictObject({
    kind: z.literal('day_trip'),
    ...dayTripFields,
    fieldSources: fieldSourcesFor('day_trip').default({}),
  }),
]);
export type RecordCreateInput = z.infer<typeof RecordCreate>;

// Patches carry no defaults: a missing key leaves the stored value alone.
const RECORD_PATCHES = {
  place: z.strictObject({ ...placeFields, fieldSources: fieldSourcesFor('place') }).partial(),
  event: z.strictObject({ ...eventFields, fieldSources: fieldSourcesFor('event') }).partial(),
  transport_note: z
    .strictObject({ ...transportFields, fieldSources: fieldSourcesFor('transport_note') })
    .partial(),
  day_trip: z
    .strictObject({ ...dayTripFields, fieldSources: fieldSourcesFor('day_trip') })
    .partial(),
};

export const recordPatchFor = (kind: CatalogKind) => RECORD_PATCHES[kind];
export type RecordPatchInput = z.infer<(typeof RECORD_PATCHES)[CatalogKind]>;

/** 'MM-DD', a real calendar day in a leap year (02-29 is allowed). */
const monthDay = z
  .string()
  .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
  .refine((value) => {
    const [m, d] = value.split('-').map(Number) as [number, number];
    return new Date(Date.UTC(2024, m - 1, d)).getUTCDate() === d;
  });

export const SeasonsBody = z.strictObject({
  seasons: z
    .array(z.strictObject({ from: monthDay, to: monthDay }))
    .max(CATALOG_LIMITS.seasonsPerRecord),
});

const civilDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
  });

export const OpeningHoursBody = z.strictObject({
  hours: z
    .array(
      z
        .strictObject({
          weekday: z.number().int().min(1).max(7),
          opens: z.string().regex(HHMM),
          closes: z.string().regex(HHMM),
          validFrom: civilDate.nullable(),
          validTo: civilDate.nullable(),
        })
        .refine((h) => h.opens !== h.closes)
        .refine((h) => h.validFrom === null || h.validTo === null || h.validFrom <= h.validTo),
    )
    .max(CATALOG_LIMITS.hoursPerRecord),
});

/** Google and Tripadvisor image hosts: their photos may not be reused (PRD §11). */
const BLOCKED_IMAGE_HOSTS = [
  'googleusercontent.com',
  'ggpht.com',
  'gstatic.com',
  'googleapis.com',
  'tripadvisor.com',
  'tacdn.com',
];

const hostOf = (url: string) => new URL(url).hostname.toLowerCase();
const isBlockedHost = (host: string) =>
  BLOCKED_IMAGE_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));

export const ImagesBody = z.strictObject({
  images: z
    .array(
      z
        .strictObject({
          url: httpsUrl,
          source: z.enum(IMAGE_SOURCES),
          licence: optionalLine(CATALOG_LIMITS.licence),
          attribution: optionalLine(CATALOG_LIMITS.attribution),
          sourcePageUrl: optionalUrl,
        })
        .refine((i) => !isBlockedHost(hostOf(i.url)))
        .refine(
          (i) =>
            i.source !== 'wikimedia_commons' ||
            (i.licence !== null &&
              i.attribution !== null &&
              i.sourcePageUrl !== null &&
              hostOf(i.url) === 'upload.wikimedia.org'),
        )
        .refine((i) => i.source !== 'venue_permission' || i.attribution !== null),
    )
    .max(CATALOG_LIMITS.imagesPerPlace),
});
