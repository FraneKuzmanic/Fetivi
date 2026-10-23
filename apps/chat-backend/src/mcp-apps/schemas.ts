import { z } from 'zod';

export const widgetQuery = z.object({ uri: z.string().startsWith('ui://').max(512) });

export const callBody = z.object({
  name: z.string().max(100),
  arguments: z.record(z.string(), z.unknown()).default({}),
});
