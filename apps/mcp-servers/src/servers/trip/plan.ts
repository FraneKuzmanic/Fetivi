import { getPlan, PLAN_LIMITS, type PlanRuleCode, PlanRuleError, updatePlan } from '@fetivi/domain';
import { offerScope } from '../services/create-order';
import { ClaimMismatchError, GuestToolError, type GuestToolSpec, guestTool } from '../tool';
import { getPlanInput, planResult, updatePlanInput } from './schemas';

export const PLAN_REFUSALS: Record<
  Exclude<PlanRuleCode, 'not-found' | 'place-not-visible' | 'offer-not-visible'>,
  string
> = {
  'date-outside-stay': "That date is outside the guest's stay.",
  'day-full': `That day already has ${PLAN_LIMITS.suggestionsPerDay} plan items; remove one first.`,
  'booked-item': 'Booked items follow their order and cannot be changed in the plan.',
  'invalid-input': 'The plan change was incomplete or invalid.',
};

/** Plan refusals as tool errors; an id the caller may not see is `not permitted`. */
async function planRefusing<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof PlanRuleError)) throw error;
    if (
      error.code === 'not-found' ||
      error.code === 'place-not-visible' ||
      error.code === 'offer-not-visible'
    ) {
      throw new ClaimMismatchError(error.code);
    }
    throw new GuestToolError(PLAN_REFUSALS[error.code]);
  }
}

export const getPlanSpec: GuestToolSpec = guestTool({
  name: 'get_plan',
  config: {
    title: 'Day plan',
    description:
      "The guest's day plan for one day or the whole stay: suggestions agreed in chat and confirmed bookings, each day with its items in time order. The guest sees it as a timeline. Read it before changing the plan.",
    scope: 'plan:read',
    inputSchema: getPlanInput,
    outputSchema: planResult,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  // Always listed, also after checkout; the scope is checked per call.
  listed: () => true,
  async handler({ date }, identity, { db, now }) {
    return { plan: await planRefusing(() => getPlan(db, identity, now(), { date })) };
  },
});

export const updatePlanSpec: GuestToolSpec = guestTool({
  name: 'update_plan',
  config: {
    title: 'Update the day plan',
    description:
      "Add, change or remove suggestions in the guest's day plan, after the guest asked for it or agreed in chat. Write titles in the guest's language. Link a place from search_places or an offer from list_offers when it is about one. Confirmed bookings appear on their day by themselves; never add them, and they cannot be changed here. Returns the changed days, which the guest sees as a timeline.",
    scope: 'plan:write',
    inputSchema: updatePlanInput,
    outputSchema: planResult,
    // Removes and overwrites items; the same add twice adds two.
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  listed: (identity) => identity.scopes.includes('plan:write'),
  async handler(args, identity, { db, now }) {
    const ctx = {
      spaceId: identity.spaceId,
      language: identity.language,
      offerScope: offerScope(identity),
    };
    return { plan: await planRefusing(() => updatePlan(db, ctx, args, now())) };
  },
});
