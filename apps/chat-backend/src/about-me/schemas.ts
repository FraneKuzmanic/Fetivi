import { BUDGETS, INTERESTS, NEEDS, PACES, PARTY_SHAPES } from '@fetivi/domain';
import { z } from 'zod';

/** The whole About me as the guest app sends it (PUT replaces). Strict: unknown keys are invalid input. */
export const aboutMeBody = z.strictObject({
  party: z.enum(PARTY_SHAPES).nullable(),
  interests: z.array(z.enum(INTERESTS)).max(INTERESTS.length),
  pace: z.enum(PACES).nullable(),
  budget: z.enum(BUDGETS).nullable(),
  needs: z.array(z.enum(NEEDS)).max(NEEDS.length),
});
