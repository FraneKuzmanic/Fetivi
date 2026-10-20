// Every controlled list of Providers and Offers. Imports nothing: the back-office SPA bundles this
// file through the `@fetivi/domain/offer-vocabulary` subpath, and the pgEnums are built from it.

/** How an Order of the Offer is settled with the Provider. Independent of Category. */
export const ORDER_KINDS = ['booking', 'ticket', 'purchase', 'request'] as const;
export type OrderKind = (typeof ORDER_KINDS)[number];

/**
 * The glossary's Category: what kind of service an Offer is. Independent of Order kind (no rule
 * links them), and not the Place category, which classifies catalog places.
 */
export const OFFER_CATEGORIES = [
  'tour',
  'boat_trip',
  'dining_experience',
  'tasting',
  'transfer',
  'rental',
  'class',
  'wellness',
  'goods',
  'other',
] as const;
export type OfferCategory = (typeof OFFER_CATEGORIES)[number];

/** Live: the Provider's booking system; allotment: seats from the deal; on request: the Provider accepts. */
export const AVAILABILITY_MODES = ['live', 'allotment', 'on_request'] as const;
export type AvailabilityMode = (typeof AVAILABILITY_MODES)[number];

export const PAYMENT_MODES = ['direct', 'online'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

/**
 * Which guest details the Provider receives besides the Order. The guest's email is always
 * required, but it goes to Fetivi, not the Provider.
 */
export const CONTACT_FIELDS = ['name', 'phone', 'name_and_phone'] as const;
export type ContactFields = (typeof CONTACT_FIELDS)[number];

/** The price is per unit of the Order's quantity. */
export const PRICE_UNITS = ['person', 'group', 'item'] as const;
export type PriceUnit = (typeof PRICE_UNITS)[number];

/** The Provider booking engines a live Offer can use. */
export const ADAPTER_KINDS = ['bokun'] as const;
export type AdapterKind = (typeof ADAPTER_KINDS)[number];

export const OFFER_DEFAULTS = {
  currency: 'EUR',
  priceUnit: 'person',
  responseWindowMinutes: 30,
  responseHoursFrom: '08:00',
  responseHoursTo: '21:00',
  freeCancelHoursBefore: 24,
  refundPercentAfter: 0,
  contactFields: 'name',
} as const;

export const OFFER_LIMITS = {
  /** 100 % in basis points. */
  commissionBpMax: 10_000,
  /** In cents. */
  priceMinorMax: 10_000_000,
  freeCancelHoursMax: 720,
  capacityMax: 999,
  slotTimesPerDay: 12,
  slotRangeDays: 366,
  slotsPerBulk: 1_000,
  externalRef: 200,
  taxNumber: 32,
  dealNotes: 2000,
} as const;

/**
 * The longest response window that always ends under 4 days (96 h) after the request. The window
 * counts only minutes between `from` and `to` ('HH:mm'), so a request just after `to` waits
 * overnight first; staying under 4 × the daily span keeps that worst case under 96 h.
 */
export function maxResponseWindowMinutes(from: string, to: string): number {
  const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  return Math.max(0, 4 * (minutes(to) - minutes(from)) - 1);
}
