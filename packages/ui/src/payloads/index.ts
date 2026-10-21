// The contracts of Fetivi's own streamed components. React-free: the chat backend validates with
// these through `@fetivi/ui/payloads`, and the guest app re-checks stored parts before rendering.
import { PLACE_CATEGORIES, STALENESS_STATUSES } from '@fetivi/domain/catalog-vocabulary';
import { z } from 'zod';

/** The UI message part type is `data-${COMPONENT_DATA_TYPE}`. */
export const COMPONENT_DATA_TYPE = 'component';
export const COMPONENT_PART_TYPE = `data-${COMPONENT_DATA_TYPE}` as const;

const short = z.string().trim().min(1).max(60);

/** 1–4 tappable replies under Fetivi's answer, written as the guest would say them. */
export const followUpChips = z.strictObject({
  replies: z.array(short).min(1).max(4),
});

/** A question with 2–6 distinct options; the app adds "Something else". */
export const choiceCard = z.strictObject({
  question: z.string().trim().min(1).max(160),
  options: z
    .array(short)
    .min(2)
    .max(6)
    .refine((options) => new Set(options).size === options.length, 'Options must be unique'),
  multiple: z.boolean().default(false),
});

/** One place as a card shows it; not strict, so an extra field from search output never drops a carousel. */
export const placeCard = z.object({
  id: z.string().min(1),
  kind: z.enum(['place', 'day_trip']),
  category: z.enum([...PLACE_CATEGORIES, 'day_trip']),
  title: z.string().min(1),
  summary: z.string(),
  location: z.object({ lat: z.number(), lng: z.number() }).nullable(),
  distanceKm: z.number().nullable(),
  travelMinutes: z.number().nullable(),
  image: z
    .object({
      url: z.string().min(1),
      attribution: z.string().nullable(),
      licence: z.string().nullable(),
      sourcePageUrl: z.string().nullable(),
    })
    .nullable(),
  verifiedAt: z.string().nullable(),
  staleness: z.object({ status: z.enum(STALENESS_STATUSES) }),
  /** The host's pick badge (host picks arrive later); nothing sets it yet. */
  hostPick: z.object({ note: z.string().nullable() }).optional(),
});

/** Places from one search, in the search's order. */
export const placeCarousel = z.object({
  places: z.array(placeCard).min(1).max(10),
});

/** A streamed component: its name and a payload valid for that name. */
export const componentPart = z.discriminatedUnion('name', [
  z.object({ name: z.literal('follow-up-chips'), payload: followUpChips }),
  z.object({ name: z.literal('choice-card'), payload: choiceCard }),
  z.object({ name: z.literal('place-carousel'), payload: placeCarousel }),
]);

export type FollowUpChipsPayload = z.infer<typeof followUpChips>;
export type ChoiceCardPayload = z.infer<typeof choiceCard>;
export type PlaceCardPayload = z.infer<typeof placeCard>;
export type PlaceCarouselPayload = z.infer<typeof placeCarousel>;
export type ComponentPart = z.infer<typeof componentPart>;
export type ComponentName = ComponentPart['name'];
/** What the model sends to the presentation tools (before defaults apply). */
export type SuggestRepliesInput = z.input<typeof followUpChips>;
export type AskChoiceInput = z.input<typeof choiceCard>;

export const COMPONENT_NAMES = [
  'follow-up-chips',
  'choice-card',
  'place-carousel',
] as const satisfies readonly ComponentName[];
