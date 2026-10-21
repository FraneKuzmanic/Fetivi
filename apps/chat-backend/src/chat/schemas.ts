import { z } from 'zod';

/** The browser sends only the new text; the server holds the history. */
export const chatBody = z.object({ text: z.string().trim().min(1).max(4000) });
