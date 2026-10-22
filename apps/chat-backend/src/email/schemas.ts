import { normaliseSpaceEmail, TIPS_UNSUBSCRIBE_TOKEN } from '@fetivi/domain';
import { z } from 'zod';

export const spaceEmail = z.string().transform(normaliseSpaceEmail).pipe(z.email().max(254));

export const emailBody = z.object({ email: spaceEmail, tips: z.boolean().optional() });

export const tipsBody = z.object({ tips: z.boolean() });

/** A mailed token: 43 base64url characters. */
export const tokenBody = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });

/** A daily-tip unsubscribe link: the space and its derived token. */
export const unsubscribeLink = z.object({
  space: z.uuid(),
  token: z.string().regex(TIPS_UNSUBSCRIBE_TOKEN),
});
