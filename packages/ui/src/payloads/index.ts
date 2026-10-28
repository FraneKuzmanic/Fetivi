// The contracts of Fetivi's own streamed components. React-free: the chat backend validates with
// these through `@fetivi/ui/payloads`, and the guest app re-checks stored parts before rendering.

import { FERRY_LINE_IDS } from '@fetivi/domain/alerts-vocabulary';
import { CALENDAR_SOURCES } from '@fetivi/domain/calendar-vocabulary';
import { PLACE_CATEGORIES, STALENESS_STATUSES } from '@fetivi/domain/catalog-vocabulary';
import { FALLBACK_LIMITS, FALLBACK_SOURCE_KINDS } from '@fetivi/domain/fallback-vocabulary';
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
import {
  NEW_TERMS_PROPOSERS,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
} from '@fetivi/domain/order-vocabulary';
import { PLAN_ITEM_KINDS } from '@fetivi/domain/plan-vocabulary';
import { STAY_LIMITS } from '@fetivi/domain/stay-vocabulary';
import { TIP_RECORD_KINDS, TIP_RULES } from '@fetivi/domain/tips-vocabulary';
import { GUEST_LANGUAGES } from '@fetivi/domain/vocabulary';
import {
  SKY_CODES,
  WARNING_LEVELS,
  WARNING_TYPES,
  WEATHER_LIMITS,
  WEATHER_SOURCES,
} from '@fetivi/domain/weather-vocabulary';
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
  /** The host's pick badge and note (40); search output sends null when not picked. */
  hostPick: z.object({ note: z.string().nullable() }).nullable().optional(),
  /** Added by the host, not in the catalog: own badge, no Save. */
  hostAdded: z.boolean().optional(),
});

/** Places from one search, in the search's order. */
export const placeCarousel = z.object({
  places: z.array(placeCard).min(1).max(10),
});

/** One event as the event list shows it; not strict, like `placeCard`. */
export const eventCard = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  /** 'YYYY-MM-DDTHH:mm' in the destination's zone. */
  startsAt: z.string().min(1),
  endsAt: z.string().min(1),
  venueName: z.string().nullable(),
  address: z.string().nullable().optional(),
  location: z.object({ lat: z.number(), lng: z.number() }).nullable(),
  distanceKm: z.number().nullable(),
});

/** Events from one search, soonest first, with a map when any has a location. */
export const eventList = z.object({
  events: z.array(eventCard).min(1).max(10),
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
  /** Defaults so receipts stored before pay-online (33) still parse. */
  payBy: z.string().nullable().default(null),
  /** What was or will be refunded, in cents; null when nothing is refunded through Fetivi. */
  refundMinor: z.number().int().nullable().default(null),
  /** Defaults so receipts stored before 36 still parse. */
  respondBy: z.string().nullable().default(null),
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

/** One plan item as the timeline shows it; not strict, like placeCard. */
export const planItem = z.object({
  id: z.string().min(1),
  kind: z.enum(PLAN_ITEM_KINDS),
  date: z.string(),
  /** 'HH:mm' at the property; null = any time. */
  time: z.string().nullable(),
  title: z.string().min(1),
  note: z.string().nullable(),
  placeId: z.string().nullable(),
  offerId: z.string().nullable(),
  orderId: z.string().nullable(),
  orderStatus: z.enum(ORDER_STATUSES).nullable(),
});

/** Days of the plan, in date order; `today` marks the property's current day. */
export const dayPlan = z.object({
  checkIn: z.string(),
  checkout: z.string(),
  today: z.string(),
  // A Stay has at most maxNights nights, so maxNights + 1 days.
  days: z
    .array(z.object({ date: z.string(), items: z.array(planItem) }))
    .min(1)
    .max(STAY_LIMITS.maxNights + 1),
});

/**
 * get_weather's result as the weather card shows it; not strict, like placeCard. A null part is
 * "could not check"; `warnings: []` is "none in force".
 */
export const weatherCard = z.object({
  /** The asked civil date. */
  date: z.string(),
  /** The property's IANA zone; warning times are shown in it. */
  timezone: z.string(),
  days: z
    .array(
      z.object({
        date: z.string(),
        sky: z.enum(SKY_CODES),
        tempMinC: z.number(),
        tempMaxC: z.number(),
        precipitationMm: z.number(),
        windMaxMs: z.number(),
      }),
    )
    .max(WEATHER_LIMITS.toolDays)
    .nullable(),
  sea: z
    .object({ station: z.string(), temperatureC: z.number(), measuredAt: z.string() })
    .nullable(),
  uv: z.object({ station: z.string(), maxToday: z.number(), measuredAt: z.string() }).nullable(),
  warnings: z
    .array(
      z.object({
        level: z.enum(WARNING_LEVELS),
        type: z.enum(WARNING_TYPES),
        event: z.string(),
        description: z.string(),
        area: z.string(),
        onset: z.string(),
        expires: z.string(),
      }),
    )
    .max(WEATHER_LIMITS.maxWarnings)
    .nullable(),
  credits: z
    .array(z.object({ source: z.enum(WEATHER_SOURCES), label: z.string(), url: z.string() }))
    .min(1),
});

/**
 * web_fallback_search's results: unchecked pages shown as links with a source chip, never as
 * place cards. Only https links; the domain already re-checked each host against the allowlist.
 */
export const webResults = z.object({
  results: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        snippet: z.string().max(400),
        url: z.url().refine((u) => u.startsWith('https://')),
        source: z.object({ host: z.string().min(1), kind: z.enum(FALLBACK_SOURCE_KINDS) }),
      }),
    )
    .min(1)
    .max(FALLBACK_LIMITS.results),
});

/** A streamed component: its name and a payload valid for that name. */
export const componentPart = z.discriminatedUnion('name', [
  z.object({ name: z.literal('follow-up-chips'), payload: followUpChips }),
  z.object({ name: z.literal('choice-card'), payload: choiceCard }),
  z.object({ name: z.literal('place-carousel'), payload: placeCarousel }),
  z.object({ name: z.literal('event-list'), payload: eventList }),
  z.object({ name: z.literal('availability-picker'), payload: availabilityPicker }),
  z.object({ name: z.literal('receipt-card'), payload: receiptCard }),
  z.object({ name: z.literal('property-info'), payload: propertyInfoCard }),
  z.object({ name: z.literal('host-message-sent'), payload: hostMessageSent }),
  z.object({ name: z.literal('day-plan'), payload: dayPlan }),
  z.object({ name: z.literal('weather'), payload: weatherCard }),
  z.object({ name: z.literal('web-results'), payload: webResults }),
]);

/**
 * The UI message part type of an external server's widget (an MCP App); its id is the tool call's
 * id. Not a component: first-party components are never MCP Apps (architecture §4.3).
 */
export const MCP_APP_PART_TYPE = 'data-mcp-app';

/** What the guest app needs to load a widget and hand it the call it shows. */
export const mcpAppPart = z.object({
  server: z.literal('ferryhopper'),
  toolName: z.string(),
  resourceUri: z.string().startsWith('ui://'),
  pinHash: z.string(),
  input: z.record(z.string(), z.unknown()),
  result: z.object({ content: z.array(z.unknown()) }).passthrough(),
});
export type McpAppPart = z.infer<typeof mcpAppPart>;

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

/** The stored cancel_order draft the cancel card shows: the policy and the refund it gives. */
export const cancelOrderDraft = z.object({
  pendingId: z.string().min(1),
  orderId: z.string().min(1),
  proposalId: z.string().min(1),
  offerTitle: z.string(),
  language: z.enum(GUEST_LANGUAGES),
  date: z.string(),
  startsAtLocal: z.string().nullable(),
  quantity: z.number().int(),
  paymentMode: z.enum(PAYMENT_MODES),
  paymentStatus: z.enum(PAYMENT_STATUSES),
  priceMinor: z.number().int().nullable(),
  currency: z.string(),
  cancellationPolicy: z.string(),
  refundMinor: z.number().int().nullable(),
  refundPercent: z.number().int().nullable(),
  freeUntil: z.string().nullable(),
  freeUntilLocal: z.string().nullable(),
});

/** The stored respond_to_order_update draft: the new terms next to the ones they replace. */
export const respondOrderDraft = z.object({
  pendingId: z.string().min(1),
  orderId: z.string().min(1),
  proposalId: z.string().min(1),
  offerTitle: z.string(),
  language: z.enum(GUEST_LANGUAGES),
  proposer: z.enum(NEW_TERMS_PROPOSERS),
  date: z.string(),
  startsAtLocal: z.string().nullable(),
  quantity: z.number().int(),
  priceMinor: z.number().int().nullable(),
  currency: z.string(),
  previous: z.object({
    date: z.string(),
    startsAtLocal: z.string().nullable(),
    priceMinor: z.number().int().nullable(),
  }),
  paymentMode: z.enum(PAYMENT_MODES),
  cancellationPolicy: z.string(),
  respondBy: z.string(),
  respondByLocal: z.string(),
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
    /**
     * create_order's draft. Exactly one of `draft`, `hostMessage`, `cancelOrder` and
     * `respondOrder` is set.
     */
    draft: orderDraft.nullable().default(null),
    hostMessage: hostMessageDraft.nullable().default(null),
    cancelOrder: cancelOrderDraft.nullable().default(null),
    respondOrder: respondOrderDraft.nullable().default(null),
  })
  .refine(
    (p) =>
      [p.draft, p.hostMessage, p.cancelOrder, p.respondOrder].filter((d) => d !== null).length ===
      1,
    'Exactly one draft',
  );

export { INBOX_PART_TYPE };

/** A plan item or booked Order a safety alert names (`AffectedItem`). */
const affectedItem = z.object({
  title: z.string(),
  /** Civil date 'YYYY-MM-DD'. */
  date: z.string(),
  /** 'HH:mm'. */
  startTime: z.string().nullable(),
  orderId: z.string().nullable(),
  lines: z.array(z.enum(FERRY_LINE_IDS)),
});

/** A safety alert's facts (`SafetyAlertFacts`): the source's own words, never Fetivi's. */
const safetyFacts = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('DHMZ'),
    level: z.enum(WARNING_LEVELS),
    type: z.enum(WARNING_TYPES),
    event: z.string(),
    description: z.string(),
    area: z.string(),
    /** ISO instants. */
    onset: z.string(),
    expires: z.string(),
    timezone: z.string(),
    advisory: affectedItem.nullable(),
  }),
  z.object({
    source: z.literal('Jadrolinija'),
    bulletinId: z.string(),
    /** As published, in Croatian. */
    title: z.string(),
    url: z.string().url(),
    timezone: z.string(),
    affected: affectedItem,
  }),
]);

/** A daily tip's facts (`DailyTipFacts`): the catalog record picked for tomorrow. */
const tipFacts = z.object({
  rule: z.enum(TIP_RULES),
  /** Civil date 'YYYY-MM-DD': tomorrow at send time. */
  date: z.string(),
  recordId: z.string(),
  kind: z.enum(TIP_RECORD_KINDS),
  /** In the space language at send time. */
  title: z.string(),
  /** Events only: 'YYYY-MM-DDTHH:mm' in the destination zone. */
  startsAt: z.string().nullable(),
  venueName: z.string().nullable(),
  distanceKm: z.number().nullable(),
});

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
    safety: safetyFacts.nullable().default(null),
    tip: tipFacts.nullable().default(null),
    at: z.string(),
  }),
]);

export type PlaceCardPayload = z.infer<typeof placeCard>;
export type EventCardPayload = z.infer<typeof eventCard>;
export type ComponentPart = z.infer<typeof componentPart>;
export type AvailabilityPickerPayload = z.infer<typeof availabilityPicker>;
export type OrderSummaryPayload = z.infer<typeof orderSummary>;
export type OrderDraft = z.infer<typeof orderDraft>;
export type ElicitationPayload = z.infer<typeof elicitationPayload>;
export type HostMessageDraftPayload = z.infer<typeof hostMessageDraft>;
export type CancelOrderDraftPayload = z.infer<typeof cancelOrderDraft>;
export type RespondOrderDraftPayload = z.infer<typeof respondOrderDraft>;
export type HostMessageSentPayload = z.infer<typeof hostMessageSent>;
export type InboxItem = z.infer<typeof inboxItem>;
export type DayPlanPayload = z.infer<typeof dayPlan>;
export type PlanItemPayload = z.infer<typeof planItem>;
export type WeatherCardPayload = z.infer<typeof weatherCard>;
export type WebResultsPayload = z.infer<typeof webResults>;
