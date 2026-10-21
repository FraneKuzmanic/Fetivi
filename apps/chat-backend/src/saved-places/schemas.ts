import { z } from 'zod';

/** The place in the URL: a catalog record id. */
export const savedPlaceParams = z.object({ placeId: z.uuid() });
