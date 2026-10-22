import { z } from 'zod';

/** `PushSubscription.toJSON()` from the host's phone; lengths bounded as for guests. */
export const hostPushSubscriptionBody = z.object({
  endpoint: z.url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(64),
  }),
});

export const hostPushUnsubscribeBody = z.object({ endpoint: z.url().max(2048) });
