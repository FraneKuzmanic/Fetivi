import { HANDOFF_LIMITS } from '@fetivi/domain';
import { z } from 'zod';

export const InboxIdParams = z.object({ id: z.uuid() });

export const InboxReply = z.strictObject({
  text: z.string().trim().min(1).max(HANDOFF_LIMITS.replyChars),
});
