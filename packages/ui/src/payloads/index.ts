// The contracts of Fetivi's own streamed components. React-free: the chat backend validates with
// these through `@fetivi/ui/payloads`, and the guest app re-checks stored parts before rendering.

import { CALENDAR_SOURCES } from '@fetivi/domain/calendar-vocabulary';
import { PLACE_CATEGORIES, STALENESS_STATUSES } from '@fetivi/domain/catalog-vocabulary';
import {
  HANDOFF_LIMITS,
  HANDOFF_REASONS,
  HANDOFF_URGENCIES,
  INBOX_PART_TYPE,
} from '@fetivi/domain/handoff-vocabulary';
import { GUEST_NOTIFICATION_KINDS } from '@fetivi/domain/notification-vocabulary';
import {
  AVAILABILITY_MODES,
  CONTACT_FIELDS,
  PAYMENT_MODES,
  PRICE_UNITS,
} from '@fetivi/domain/offer-vocabulary';
import { ORDER_STATUSES, PAYMENT_STATUSES } from '@fetivi/domain/order-vocabulary';
import { GUEST_LANGUAGES } from '@fetivi/domain/vocabulary';
import { z } from 'zod';
import { propertyInfoCard } from './property-info';

export * from './property-info';

/** The UI message part type of a streamed component. */
export const COMPONENT_PART_TYPE = 'data-component';

const short = z.string().trim().min(1).max(60);

/** 1–4 tappable replies under Fetivi's answer, written as the guest would say them. */
export const followUpChips = z.strictObject({
  replies: z.array(short).min(1).max(4),
});

/** A question with 2–6 distinct options; the app adds "Something else". */
export const choiceCard = z.strictObject({
  question: z.string().trim().min(1).max(160),
  options: z
    .array(short)
    .min(2)
    .max(6)
    .refine((options) => new Set(options).size === options.length, 'Options must be unique'),
  multiple: z.boolean().default(false),
});

/** One place as a card shows it; not strict, so an extra field from search output never drops a carousel. */
export const placeCard = z.object({
  id: z.string().min(1),
  kind: z.enum(['place', 'day_trip']),
  category: z.enum([...PLACE_CATEGORIES, 'day_trip']),
  title: z.string().min(1),
  summary: z.string(),
  location: z.object({ lat: z.number(), lng: z.number() }).nullable(),
  distanceKm: z.number().nullable(),
  travelMinutes: z.number().nullable(),
  image: z
    .object({
      url: z.string().min(1),
      attribution: z.string().nullable(),
      licence: z.string().nullable(),
      sourcePageUrl: z.string().nullable(),
    })
    .nullable(),
  verifiedAt: z.string().nullable(),
  staleness: z.object({ status: z.enum(STALENESS_STATUSES) }),
  /** The host's pick badge (host picks arrive later); nothing sets it yet. */
  hostPick: z.object({ note: z.string().nullable() }).optional(),
});

/** Places from one search, in the search's order. */
export const placeCarousel = z.object({
  places: z.array(placeCard).min(1).max(10),
});

/** The starts of one day from check_availability; tapping one tells Fetivi the guest's pick. */
export const availabilityPicker = z.object({
  offerId: z.string().min(1),
  date: z.string().min(1),
  quantity: z.number().int().min(1),
  starts: z
    .array(
      z.object({
        slotId: z.string().nullable(),
        /** 'YYYY-MM-DDTHH:mm' at the property; null when the Offer has no start time. */
        startsAtLocal: z.string().nullable(),
        remaining: z.number().nullable(),
      }),
    )
    .min(1)
    .max(24),
});

/** One Order as the guest sees it: the receipt in chat and in My trip. */
export const orderSummary = z.object({
  id: z.string().min(1),
  offerId: z.string().min(1),
  offerTitle: z.string(),
  status: z.enum(ORDER_STATUSES),
  paymentStatus: z.enum(PAYMENT_STATUSES),
  paymentMode: z.enum(PAYMENT_MODES),
  date: z.string(),
  startsAt: z.string().nullable(),
  startsAtLocal: z.string().nullable(),
  quantity: z.number(),
  priceMinor: z.number().nullable(),
  currency: z.string(),
  priceUnit: z.enum(PRICE_UNITS),
  createdAt: z.string(),
});

export const receiptCard = z.object({ order: orderSummary });

/** A Host message as the guest's card shows it once sent. */
export const hostMessageSent = z.object({
  message: z.object({
    id: z.string().min(1),
    text: z.string(),
    urgency: z.enum(HANDOFF_URGENCIES),
    sentAt: z.string(),
  }),
});

/** A streamed component: its name and a payload valid for that name. */
export const componentPart = z.discriminatedUnion('name', [
  z.object({ name: z.literal('follow-up-chips'), payload: followUpChips }),
  z.object({ name: z.literal('choice-card'), payload: choiceCard }),
  z.object({ name: z.literal('place-carousel'), payload: placeCarousel }),
  z.object({ name: z.literal('availability-picker'), payload: availabilityPicker }),
  z.object({ name: z.literal('receipt-card'), payload: receiptCard }),
  z.object({ name: z.literal('property-info'), payload: propertyInfoCard }),
  z.object({ name: z.literal('host-message-sent'), payload: hostMessageSent }),
]);

/** The UI message part type of a confirmation card; its id is the paused tool call's id. */
export const ELICITATION_PART_TYPE = 'data-elicitation';

/** The stored create_order draft the card shows; never model text. Not strict, like placeCard. */
export const orderDraft = z.object({
  pendingId: z.string().min(1),
  offerId: z.string().min(1),
  offerTitle: z.string(),
  language: z.enum(GUEST_LANGUAGES),
  date: z.string(),
  slotId: z.string().nullable(),
  startsAt: z.string().nullable(),
  startsAtLocal: z.string().nullable(),
  quantity: z.number().int(),
  priceMinor: z.number().int().nullable(),
  currency: z.string(),
  priceUnit: z.enum(PRICE_UNITS),
  paymentMode: z.enum(PAYMENT_MODES),
  availabilityMode: z.enum(AVAILABILITY_MODES),
  cancellationPolicy: z.string(),
  contactFields: z.enum(CONTACT_FIELDS),
});

/** The stored send_host_message draft the host message card shows; the guest may edit the text. */
export const hostMessageDraft = z.object({
  pendingId: z.string().min(1),
  messageId: z.string().min(1),
  text: z.string().min(1).max(HANDOFF_LIMITS.messageChars),
  reason: z.enum(HANDOFF_REASONS),
  urgency: z.enum(HANDOFF_URGENCIES),
  language: z.enum(GUEST_LANGUAGES),
});

/**
 * A paused write tool's confirmation: the server's form (message and schema), the stored draft
 * and the opaque `requestState`, which the backend sends back byte for byte.
 */
export const elicitationPayload = z
  .object({
    toolCallId: z.string().min(1),
    toolName: z.string().min(1),
    key: z.string().min(1),
    message: z.string(),
    requestedSchema: z
      .object({
        type: z.literal('object'),
        properties: z.record(
          z.string(),
          z
            .object({
              type: z.string(),
              format: z.string().optional(),
              title: z.string().optional(),
              description: z.string().optional(),
            })
            .passthrough(),
        ),
        required: z.array(z.string()).optional(),
      })
      .passthrough(),
    requestState: z.string().min(1),
    /** create_order's draft. Exactly one of `draft` and `hostMessage` is set. */
    draft: orderDraft.nullable().default(null),
    hostMessage: hostMessageDraft.nullable().default(null),
  })
  .refine((p) => (p.draft === null) !== (p.hostMessage === null), 'Exactly one draft');

export { INBOX_PART_TYPE };

/**
 * An inbox message in the Chat: the host's reply, or a notice (an Order or Stay notification)
 * that the guest app words in the current language. Notices never reach the model.
 */
export const inboxItem = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('host-reply'),
    handoffId: z.string().min(1),
    /** The translation, or the reply itself when none is shown. */
    text: z.string(),
    /** The host's own words, only when a translation is shown. */
    original: z.string().nullable(),
    repliedAt: z.string(),
  }),
  z.object({
    kind: z.literal('notice'),
    notification: z.enum(GUEST_NOTIFICATION_KINDS),
    orderId: z.string().nullable().default(null),
    /** In the space language at send time. */
    offerTitle: z.string().nullable().default(null),
    /** Civil date 'YYYY-MM-DD'. */
    date: z.string().nullable().default(null),
    /** 'HH:mm'. */
    startTime: z.string().nullable().default(null),
    /** 'HH:mm'. */
    checkoutTime: z.string().nullable().default(null),
    reviewPlatform: z.enum(CALENDAR_SOURCES).nullable().default(null),
    reviewUrl: z.string().url().nullable().default(null),
    at: z.string(),
  }),
]);

export type PlaceCardPayload = z.infer<typeof placeCard>;
export type ComponentPart = z.infer<typeof componentPart>;
export type AvailabilityPickerPayload = z.infer<typeof availabilityPicker>;
export type OrderSummaryPayload = z.infer<typeof orderSummary>;
export type OrderDraft = z.infer<typeof orderDraft>;
export type ElicitationPayload = z.infer<typeof elicitationPayload>;
export type HostMessageDraftPayload = z.infer<typeof hostMessageDraft>;
export type HostMessageSentPayload = z.infer<typeof hostMessageSent>;
export type InboxItem = z.infer<typeof inboxItem>;
