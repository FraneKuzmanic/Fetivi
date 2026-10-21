import {
  type EventSearch,
  IMAGE_SOURCES,
  PLACE_CATEGORIES,
  type PlaceDetail,
  type PlaceSearch,
  STALENESS_STATUSES,
  TRANSPORT_MODES,
  type TransportNote,
} from '@fetivi/domain';
import { z } from 'zod';

const civilDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe('YYYY-MM-DD');
const searchText = z.string().trim().min(2).max(80);
const placeCategory = z.enum([...PLACE_CATEGORIES, 'day_trip']);

export const searchPlacesInput = z.object({
  query: searchText
    .optional()
    .describe('A few words in any language, e.g. "sandy beach" or "fortress".'),
  category: placeCategory.optional(),
  maxDistanceKm: z.number().min(0.1).max(100).optional(),
  date: civilDate
    .optional()
    .describe('The day the guest asks about; default today, or check-in before arrival.'),
  openAt: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional()
    .describe('HH:MM local time on that day; drops places known to be closed then.'),
  limit: z.number().int().min(1).max(10).optional(),
});
export const getPlaceInput = z.object({ placeId: z.uuid() });
export const searchEventsInput = z.object({
  query: searchText.optional(),
  from: civilDate.optional(),
  to: civilDate.optional(),
});
export const transportNotesInput = z.object({
  mode: z.enum(TRANSPORT_MODES).optional(),
  query: searchText.optional(),
});

const latLng = z.object({ lat: z.number(), lng: z.number() });
const staleness = z.object({ status: z.enum(STALENESS_STATUSES), staleAt: z.string().nullable() });
const source = z.object({ field: z.string(), url: z.string() });
const image = z.object({
  url: z.string(),
  source: z.enum(IMAGE_SOURCES),
  licence: z.string().nullable(),
  attribution: z.string().nullable(),
  sourcePageUrl: z.string().nullable(),
});

const placeBase = {
  id: z.string(),
  kind: z.enum(['place', 'day_trip']),
  category: placeCategory,
  title: z.string(),
  location: latLng.nullable(),
  distanceKm: z.number().nullable(),
  travelMinutes: z.number().nullable(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  websiteUrl: z.string().nullable(),
  image: image.nullable(),
  verifiedAt: z.string().nullable(),
  staleness,
  sources: z.array(source),
};

const placeSummary = z.object({
  ...placeBase,
  summary: z.string(),
  open: z.enum(['open', 'closed', 'unknown']).nullable(),
});
const placeDetail = z.object({
  ...placeBase,
  description: z.string(),
  seasons: z.array(z.object({ from: z.string(), to: z.string() })),
  openingHours: z.array(
    z.object({
      weekday: z.number(),
      opens: z.string(),
      closes: z.string(),
      validFrom: z.string().nullable(),
      validTo: z.string().nullable(),
    }),
  ),
  inSeasonToday: z.boolean(),
  images: z.array(image),
});
const eventSummary = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  venueName: z.string().nullable(),
  location: latLng.nullable(),
  distanceKm: z.number().nullable(),
  websiteUrl: z.string().nullable(),
  verifiedAt: z.string().nullable(),
  staleness,
  sources: z.array(source),
});
const transportNote = z.object({
  id: z.string(),
  mode: z.enum(TRANSPORT_MODES),
  title: z.string(),
  description: z.string(),
  links: z.array(z.object({ label: z.string(), url: z.string() })),
  verifiedAt: z.string().nullable(),
  staleness,
  sources: z.array(source),
});

export const searchPlacesOutput = z.object({
  date: z.string(),
  openAt: z.string().nullable(),
  results: z.array(placeSummary),
});
export const getPlaceOutput = z.object({ place: placeDetail });
export const searchEventsOutput = z.object({
  window: z.object({ from: z.string(), to: z.string() }),
  results: z.array(eventSummary),
});
export const transportNotesOutput = z.object({ results: z.array(transportNote) });

// A drift between the domain types and these schemas fails typecheck, not a tool call.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _schemasMatch: [
  Same<z.infer<typeof searchPlacesOutput>, PlaceSearch>,
  Same<z.infer<typeof placeDetail>, PlaceDetail>,
  Same<z.infer<typeof searchEventsOutput>, EventSearch>,
  Same<z.infer<typeof transportNote>, TransportNote>,
] = [true, true, true, true];
void _schemasMatch;
