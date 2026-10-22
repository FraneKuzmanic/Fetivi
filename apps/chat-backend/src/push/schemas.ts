import { z } from 'zod';

/** `PushSubscription.toJSON()` from the guest's browser; lengths bounded. */
export const pushSubscriptionBody = z.object({
  endpoint: z.url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(64),
  }),
});
