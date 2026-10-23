import { OFFER_LIMITS } from '@fetivi/domain';
import { z } from 'zod';
import { civilDate } from '../catalog/schemas';
import { HHMM } from '../properties/schemas';

export const HostOrderParams = z.object({ id: z.uuid() });

/** One tap in the inbox, bound to the proposal the card showed (38). */
export const HostOrderAction = z.strictObject({
  action: z.enum([
    'acknowledge',
    'cannot_fulfil',
    'accept',
    'decline',
    'suggest_time',
    'accept_with_price',
  ]),
  proposalId: z.uuid(),
  // New terms, for suggest_time and accept_with_price.
  date: civilDate.optional(),
  time: z.string().regex(HHMM).optional(),
  /** In cents. */
  priceMinor: z.number().int().min(1).max(OFFER_LIMITS.priceMinorMax).optional(),
});
