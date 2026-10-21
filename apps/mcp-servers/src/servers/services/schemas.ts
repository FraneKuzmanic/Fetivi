import {
  AVAILABILITY_MODES,
  type Availability,
  CONTACT_FIELDS,
  type GuestOffer,
  OFFER_CATEGORIES,
  ORDER_KINDS,
  ORDER_STATUSES,
  type OrderSummary,
  PAYMENT_MODES,
  PAYMENT_STATUSES,
  PRICE_UNITS,
} from '@fetivi/domain';
import { z } from 'zod';

const civilDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe('YYYY-MM-DD, a day of the stay');
// The machine allows up to 999; a guest party is never 100 or more.
const quantity = z
  .number()
  .int()
  .min(1)
  .max(99)
  .describe('People, or items for a per-item price, or 1 for a per-group price.');

export const listOffersInput = z.object({
  category: z.enum(OFFER_CATEGORIES).optional(),
  placeId: z.uuid().optional().describe('A place id from search_places, for its offerIds.'),
});
export const checkAvailabilityInput = z.object({
  offerId: z.uuid(),
  date: civilDate,
  quantity,
});
export const listMyOrdersInput = z.object({});
export const createOrderInput = z.object({
  offerId: z.uuid(),
  date: civilDate,
  quantity,
  slotId: z
    .uuid()
    .optional()
    .describe('slotId from check_availability; required when the day has more than one start.'),
});

const guestOffer = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  cancellationPolicy: z.string(),
  category: z.enum(OFFER_CATEGORIES),
  orderKind: z.enum(ORDER_KINDS),
  availabilityMode: z.enum(AVAILABILITY_MODES),
  paymentMode: z.enum(PAYMENT_MODES),
  priceMinor: z
    .number()
    .nullable()
    .describe('In cents per priceUnit; null when the provider names the price.'),
  currency: z.string(),
  priceUnit: z.enum(PRICE_UNITS),
  contactFields: z.enum(CONTACT_FIELDS),
  placeId: z.string().nullable(),
  owner: z.enum(['provider', 'host']),
});
const orderSummary = z.object({
  id: z.string(),
  offerId: z.string(),
  offerTitle: z.string(),
  status: z.enum(ORDER_STATUSES),
  paymentStatus: z.enum(PAYMENT_STATUSES),
  paymentMode: z.enum(PAYMENT_MODES),
  date: z.string(),
  startsAt: z.string().nullable(),
  startsAtLocal: z.string().nullable().describe('Local time at the property, YYYY-MM-DDTHH:mm.'),
  quantity: z.number(),
  priceMinor: z.number().nullable().describe('The total in cents.'),
  currency: z.string(),
  priceUnit: z.enum(PRICE_UNITS).describe('What quantity counts.'),
  createdAt: z.string(),
});

export const listOffersOutput = z.object({ offers: z.array(guestOffer) });
export const checkAvailabilityOutput = z.object({
  offerId: z.string(),
  date: z.string(),
  quantity: z.number(),
  starts: z.array(
    z.object({
      slotId: z.string().nullable(),
      startsAt: z.string().nullable(),
      startsAtLocal: z
        .string()
        .nullable()
        .describe('Local time at the property, YYYY-MM-DDTHH:mm; use it with the guest.'),
      remaining: z.number().nullable(),
    }),
  ),
});
export const listMyOrdersOutput = z.object({ orders: z.array(orderSummary) });
export const createOrderOutput = z.object({
  outcome: z.enum(['ordered', 'not_ordered']),
  order: orderSummary.nullable(),
});

// A drift between the domain types and these schemas fails typecheck, not a tool call.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _schemasMatch: [
  Same<z.infer<typeof guestOffer>, GuestOffer>,
  Same<z.infer<typeof orderSummary>, OrderSummary>,
  Same<z.infer<typeof checkAvailabilityOutput>, Availability>,
] = [true, true, true];
void _schemasMatch;
