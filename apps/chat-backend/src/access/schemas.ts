import { GUEST_LANGUAGES, PIN_PATTERN } from '@fetivi/domain';
import { z } from 'zod';

export const slugParams = z.object({ slug: z.string().min(1).max(64) });

export const pinBody = z.object({
  pin: z.string().regex(PIN_PATTERN),
  language: z.enum(GUEST_LANGUAGES),
});

export const languageBody = z.object({ language: z.enum(GUEST_LANGUAGES) });
