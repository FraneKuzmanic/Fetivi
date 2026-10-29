import {
  AVAILABILITY_MODES,
  type Availability,
  CONTACT_FIELDS,
  GUEST_NOTE_MAX,
  type GuestOffer,
  OFFER_CATEGORIES,
  ORDER_KINDS,
  ORDER_STATUSES,
  type OrderSummary,
  orderWarningSchema,
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
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const listOffersInput = z.object({
  category: z.enum(OFFER_CATEGORIES).optional(),
  placeId: z.uuid().optional().describe('A place id from search_places, for its offerIds.'),
});
export const checkAvailabilityInput = z.object({
  offerId: z.uuid(),
  date: civilDate,
  quantity,
  time: hhmm
    .optional()
    .describe("The guest's wished start, HH:mm, for an offer whose starts have no time."),
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
  time: hhmm
    .optional()
    .describe(
      'For an offer whose start has no time: the time the guest asked for, HH:mm. The guest can change it on the card.',
    ),
  note: z
    .string()
    .trim()
    .max(GUEST_NOTE_MAX)
    .optional()
    .describe(
      "What the provider needs to know, from the conversation, in the guest's words: pickup place and destination, luggage, handover, group. The guest can edit it on the card.",
    ),
});
export const cancelOrderInput = z.object({
  orderId: z.uuid().describe('An order id from list_my_orders.'),
});
export const respondToOrderUpdateInput = z.object({
  orderId: z.uuid().describe('An order id from list_my_orders whose respondBy is set.'),
});

const freeCancelHoursBefore = z
  .number()
  .describe('Cancelling is free until this many hours before the start.');
const lateChargePercent = z
  .number()
  .describe(
    'Share of the price the guest loses when cancelling later. paymentMode direct: the provider may ask the guest to pay this share directly to them; nothing is ever refunded. paymentMode online: this share is kept and the rest refunded.',
  );

const guestOffer = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  cancellationPolicy: z
    .string()
    .describe(
      "The provider's own words. What cancelling costs comes from cancellation; never promise a refund from this text.",
    ),
  cancellation: z.object({ freeCancelHoursBefore, lateChargePercent }),
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
  payBy: z
    .string()
    .nullable()
    .describe(
      'While set, the guest pays on a secure page via the Pay now button on the receipt, by this time; never paste a link.',
    ),
  refundMinor: z
    .number()
    .nullable()
    .describe(
      'What was or will be refunded, in cents; null when nothing is refunded through Fetivi. Only for paymentMode online with a payment authorized or captured.',
    ),
  respondBy: z
    .string()
    .nullable()
    .describe(
      'While set, the provider proposed new terms; call respond_to_order_update so the guest can accept or decline them by this time.',
    ),
  cancellation: z
    .object({
      freeCancelHoursBefore,
      lateChargePercent,
      freeUntil: z.string().describe('When free cancellation ends, ISO instant.'),
      freeUntilLocal: z
        .string()
        .describe('When free cancellation ends, local time at the property, YYYY-MM-DDTHH:mm.'),
      freeWindowPassed: z.boolean().describe('True once free cancellation has ended.'),
      awaitingAcceptance: z
        .enum(['provider', 'host'])
        .nullable()
        .describe(
          'While set, cancelling is free until the provider or host accepts; freeUntil applies after that.',
        ),
    })
    .nullable()
    .describe('What cancelling costs now. Null for a finished order.'),
  note: z.string().nullable().describe("The guest's note on the order."),
  owner: z
    .enum(['provider', 'host'])
    .describe(
      `host: the guest's host sells it and accepts it; say "your host", never "the provider".`,
    ),
  orderKind: z.enum(ORDER_KINDS),
  availabilityMode: z.enum(AVAILABILITY_MODES),
  responseDueLocal: z
    .string()
    .nullable()
    .describe(
      'While the provider or host has yet to answer: when the answer is due, local time at the property.',
    ),
});

export const listOffersOutput = z.object({ offers: z.array(guestOffer) });
export const checkAvailabilityOutput = z.object({
  offerId: z.string(),
  date: z.string(),
  quantity: z.number(),
  totalMinor: z
    .number()
    .nullable()
    .describe('The total for quantity in cents; null when the provider names the price.'),
  currency: z.string(),
  weatherChecked: z
    .boolean()
    .nullable()
    .describe(
      'False: DHMZ warnings could not be checked; never say there are none. Null: not an outdoor offer.',
    ),
  starts: z.array(
    z.object({
      slotId: z.string().nullable(),
      startsAt: z.string().nullable(),
      startsAtLocal: z
        .string()
        .nullable()
        .describe('Local time at the property, YYYY-MM-DDTHH:mm; use it with the guest.'),
      remaining: z.number().nullable(),
      warnings: z
        .array(orderWarningSchema)
        .describe(
          'Say each one to the guest before create_order: checkout_day = it clashes with checkout at checkoutTime; weather = a DHMZ warning of that level on the day.',
        ),
    }),
  ),
});
export const listMyOrdersOutput = z.object({ orders: z.array(orderSummary) });
export const createOrderOutput = z.object({
  outcome: z.enum(['ordered', 'not_ordered']),
  order: orderSummary.nullable(),
});
export const cancelOrderOutput = z.object({
  outcome: z.enum(['cancelled', 'not_cancelled']),
  order: orderSummary.nullable(),
});
export const respondToOrderUpdateOutput = z.object({
  outcome: z.enum(['accepted', 'declined', 'not_answered']),
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
