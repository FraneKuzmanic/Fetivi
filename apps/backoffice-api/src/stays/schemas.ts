import { GUEST_LANGUAGES, STAY_LIMITS } from '@fetivi/domain';
import { z } from 'zod';
import { optionalLine } from '../properties/schemas';

// Strict objects: a body can never carry pin, unitId, activeUntil or possiblyCancelled.

const civilDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const StayCreate = z.strictObject({
  checkIn: civilDate,
  checkout: civilDate,
  partySize: z.number().int().min(STAY_LIMITS.partySize.min).max(STAY_LIMITS.partySize.max),
  bookerName: optionalLine(STAY_LIMITS.bookerName).optional(),
  reservationNumber: optionalLine(STAY_LIMITS.reservationNumber).optional(),
  handoverLanguage: z.enum(GUEST_LANGUAGES).optional(),
});

export const StayPatch = StayCreate.partial().extend({ pinSent: z.boolean().optional() });

export const StaysQuery = z.object({
  unitId: z.uuid().optional(),
  past: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});
