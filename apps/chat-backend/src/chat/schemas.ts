import { FEEDBACK_REASONS, THUMBS } from '@fetivi/domain';
import { z } from 'zod';
import { guestAnswer } from '../loop/elicitation';

/** The browser sends only new text, or the guest's answer to a card; the server holds the history. */
export const chatBody = z.union([
  z.strictObject({ text: z.string().trim().min(1).max(4000) }),
  z.strictObject({ answer: guestAnswer }),
]);

/** A thumb and an optional one-tap reason; nothing the guest typed (43 AC 1). */
export const feedbackBody = z
  .object({
    thumb: z.enum(THUMBS).nullable(),
    reason: z.enum(FEEDBACK_REASONS).nullable(),
  })
  .strict();

export const messageParams = z.object({ id: z.string().min(1).max(100) });
