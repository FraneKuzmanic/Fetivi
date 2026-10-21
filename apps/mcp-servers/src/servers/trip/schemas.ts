import { type AboutMe, BUDGETS, INTERESTS, NEEDS, PACES, PARTY_SHAPES } from '@fetivi/domain';
import { z } from 'zod';

const party = z.enum(PARTY_SHAPES);
const interest = z.enum(INTERESTS);
const pace = z.enum(PACES);
const budget = z.enum(BUDGETS);

export const getAboutMeInput = z.strictObject({});

/** Ordinary preferences only. Strict: any other key (needs, health, religion, special, …) fails validation. */
export const updateAboutMeInput = z.strictObject({
  party: party.nullable().optional().describe("Who's travelling; null clears it."),
  addInterests: z.array(interest).max(INTERESTS.length).optional(),
  removeInterests: z.array(interest).max(INTERESTS.length).optional(),
  pace: pace.nullable().optional().describe('The pace they like; null clears it.'),
  budget: budget.nullable().optional().describe('Their budget feel; null clears it.'),
});

const aboutMeOutput = z.object({
  party: party.nullable(),
  interests: z.array(interest),
  pace: pace.nullable(),
  budget: budget.nullable(),
  needs: z.array(z.enum(NEEDS)),
});
export const aboutMeResult = z.object({ aboutMe: aboutMeOutput });

// A drift between the domain type and this schema fails typecheck, not a tool call.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _schemasMatch: Same<z.infer<typeof aboutMeOutput>, AboutMe> = true;
void _schemasMatch;
