import { GUEST_LANGUAGES, PIN_PATTERN } from '@fetivi/domain';
import { z } from 'zod';

export const slugParams = z.object({ slug: z.string().min(1).max(64) });

export const pinBody = z.object({
  pin: z.string().regex(PIN_PATTERN),
  language: z.enum(GUEST_LANGUAGES),
});

/** The guest's language, the evaluation opt-in, or both. */
export const spacePatchBody = z
  .strictObject({
    language: z.enum(GUEST_LANGUAGES).optional(),
    keepForEvaluation: z.boolean().optional(),
  })
  .refine(
    (b) => b.language !== undefined || b.keepForEvaluation !== undefined,
    'Nothing to change',
  );
