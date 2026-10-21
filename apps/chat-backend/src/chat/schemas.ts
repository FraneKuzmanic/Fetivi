import { z } from 'zod';
import { guestAnswer } from '../loop/elicitation';

/** The browser sends only new text, or the guest's answer to a card; the server holds the history. */
export const chatBody = z.union([
  z.strictObject({ text: z.string().trim().min(1).max(4000) }),
  z.strictObject({ answer: guestAnswer }),
]);
