import { z } from 'zod';

// `pin` only keys the browser's HTTP cache; the server always serves its current pin.
export const widgetQuery = z.object({
  uri: z.string().startsWith('ui://').max(512),
  pin: z.string().max(128).optional(),
});

export const callBody = z.object({
  name: z.string().max(100),
  arguments: z.record(z.string(), z.unknown()).default({}),
});
