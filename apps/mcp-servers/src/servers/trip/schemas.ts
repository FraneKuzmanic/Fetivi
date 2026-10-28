import {
  type AboutMe,
  BUDGETS,
  INTERESTS,
  NEEDS,
  ORDER_STATUSES,
  PACES,
  PARTY_SHAPES,
  PLAN_ITEM_KINDS,
  PLAN_LIMITS,
  PLAN_TIME,
  type Plan,
  TRANSPORTS,
} from '@fetivi/domain';
import { z } from 'zod';

const party = z.enum(PARTY_SHAPES);
const interest = z.enum(INTERESTS);
const pace = z.enum(PACES);
const budget = z.enum(BUDGETS);
const transport = z.enum(TRANSPORTS);

export const getAboutMeInput = z.strictObject({});

/** Ordinary preferences only. Strict: any other key (needs, health, religion, special, …) fails validation. */
export const updateAboutMeInput = z.strictObject({
  party: party.nullable().optional().describe("Who's travelling; null clears it."),
  addInterests: z.array(interest).max(INTERESTS.length).optional(),
  removeInterests: z.array(interest).max(INTERESTS.length).optional(),
  pace: pace.nullable().optional().describe('The pace they like; null clears it.'),
  budget: budget.nullable().optional().describe('Their budget feel; null clears it.'),
  transport: transport
    .nullable()
    .optional()
    .describe('How they get around: car, scooter_bike or foot_transit; null clears it.'),
});

const aboutMeOutput = z.object({
  party: party.nullable(),
  interests: z.array(interest),
  pace: pace.nullable(),
  budget: budget.nullable(),
  transport: transport.nullable(),
  needs: z.array(z.enum(NEEDS)),
});
export const aboutMeResult = z.object({ aboutMe: aboutMeOutput });

const civilDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z
  .string()
  .regex(PLAN_TIME)
  .describe("Local start time at the property, 'HH:mm'; null or absent = any time.");
const title = z.string().trim().min(1).max(PLAN_LIMITS.titleChars);
const note = z.string().trim().max(PLAN_LIMITS.noteChars);
const placeId = z.string().describe('An id from search_places');
const offerId = z.string().describe('An id from list_offers');

export const getPlanInput = z.strictObject({
  date: civilDate.optional().describe('One day of the stay; omit for the whole stay.'),
});

/** One call, all or nothing. Booked items are not changed here. */
export const updatePlanInput = z.strictObject({
  add: z
    .array(
      z.strictObject({
        date: civilDate.describe('A day of the stay, YYYY-MM-DD.'),
        time: time.nullable().optional(),
        title: title.describe("Short, in the guest's language."),
        note: note.nullable().optional(),
        placeId: placeId.nullable().optional(),
        offerId: offerId.nullable().optional(),
      }),
    )
    .max(PLAN_LIMITS.opsPerCall)
    .optional(),
  update: z
    .array(
      z.strictObject({
        itemId: z.string().describe('A suggestion id from get_plan.'),
        date: civilDate.optional(),
        time: time.nullable().optional(),
        title: title.optional(),
        note: note.nullable().optional(),
        placeId: placeId.nullable().optional(),
        offerId: offerId.nullable().optional(),
      }),
    )
    .max(PLAN_LIMITS.opsPerCall)
    .optional(),
  remove: z
    .array(z.string().describe('A suggestion id from get_plan.'))
    .max(PLAN_LIMITS.opsPerCall)
    .optional(),
});

const planItemOutput = z.object({
  id: z.string(),
  kind: z.enum(PLAN_ITEM_KINDS),
  date: z.string(),
  time: z.string().nullable(),
  title: z.string(),
  note: z.string().nullable(),
  placeId: z.string().nullable(),
  offerId: z.string().nullable(),
  orderId: z.string().nullable(),
  orderStatus: z.enum(ORDER_STATUSES).nullable(),
});
const planOutput = z.object({
  checkIn: z.string(),
  checkout: z.string(),
  today: z.string(),
  days: z.array(z.object({ date: z.string(), items: z.array(planItemOutput) })),
});
export const planResult = z.object({ plan: planOutput });

// A drift between the domain type and this schema fails typecheck, not a tool call.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _schemasMatch: Same<z.infer<typeof aboutMeOutput>, AboutMe> = true;
void _schemasMatch;
const _planMatches: Same<z.infer<typeof planOutput>, Plan> = true;
void _planMatches;
