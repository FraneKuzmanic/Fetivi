import { z } from 'zod';
import type { OfferCategory } from '../offers/vocabulary';
import { type CivilDate, endOfCivilDay, fromLocalDateTime, startOfCivilDay } from '../time';
import type { WeatherWarning } from '../weather/source';
import {
  WARNING_LEVELS,
  WARNING_TYPES,
  type WarningLevel,
  type WarningType,
} from '../weather/vocabulary';

/** Outdoor and sea categories: the ones a wind or storm warning can spoil. */
export const OUTDOOR_CATEGORIES = [
  'boat_trip',
  'tour',
  'rental',
] as const satisfies readonly OfferCategory[];
export const WEATHER_WARNING_TYPES = [
  'wind',
  'thunderstorm',
] as const satisfies readonly WarningType[];
/** The checkout clash margin: a start less than this after checkout clashes. */
export const CHECKOUT_MARGIN_MINUTES = 60;
/** At most this many weather warnings on one order, the most severe kept. */
export const MAX_ORDER_WEATHER_WARNINGS = 3;

export type OrderWarning =
  /** 'HH:mm', or null when the host set no checkout time. */
  | { kind: 'checkout_day'; checkoutTime: string | null }
  | {
      kind: 'weather';
      level: WarningLevel;
      type: WarningType;
      event: string;
      /** ISO instants. */
      onset: string;
      expires: string;
    };

export const orderWarningSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('checkout_day'), checkoutTime: z.string().nullable() }),
  z.object({
    kind: z.literal('weather'),
    level: z.enum(WARNING_LEVELS),
    type: z.enum(WARNING_TYPES),
    event: z.string(),
    onset: z.string(),
    expires: z.string(),
  }),
]);

export function isOutdoorCategory(category: OfferCategory): boolean {
  return (OUTDOOR_CATEGORIES as readonly OfferCategory[]).includes(category);
}

/**
 * What the guest should hear before deciding on an order. Offers have no duration, so on checkout
 * day any start before checkout + the margin clashes, and an unknown start always does.
 */
export function orderWarnings(input: {
  date: CivilDate;
  start: Date | null;
  zone: string;
  now: Date;
  checkout: CivilDate;
  /** 'HH:mm', or null when none is set. */
  checkoutTime: string | null;
  category: OfferCategory;
  /** null: could not check. */
  weather: WeatherWarning[] | null;
}): OrderWarning[] {
  const out: OrderWarning[] = [];
  if (input.date === input.checkout && checkoutClash(input)) {
    out.push({ kind: 'checkout_day', checkoutTime: input.checkoutTime });
  }
  if (isOutdoorCategory(input.category) && input.weather) {
    const from = Math.max(input.now.getTime(), startOfCivilDay(input.date, input.zone).getTime());
    const until = endOfCivilDay(input.date, input.zone).getTime();
    const types: readonly WarningType[] = WEATHER_WARNING_TYPES;
    const relevant = input.weather.filter(
      (w) => types.includes(w.type) && Date.parse(w.onset) < until && Date.parse(w.expires) > from,
    );
    for (const w of capWarnings(relevant)) {
      out.push({
        kind: 'weather',
        level: w.level,
        type: w.type,
        event: w.event,
        onset: w.onset,
        expires: w.expires,
      });
    }
  }
  return out;
}

function checkoutClash(input: {
  start: Date | null;
  zone: string;
  checkout: CivilDate;
  checkoutTime: string | null;
}): boolean {
  if (!input.start || !input.checkoutTime) return true;
  const checkoutAt = fromLocalDateTime(`${input.checkout}T${input.checkoutTime}`, input.zone);
  return input.start.getTime() < checkoutAt.getTime() + CHECKOUT_MARGIN_MINUTES * 60_000;
}

/** Most severe first, so a red warning is never dropped for a yellow one. */
function capWarnings(warnings: WeatherWarning[]): WeatherWarning[] {
  const severity = (w: WeatherWarning) => WARNING_LEVELS.indexOf(w.level);
  return [...warnings]
    .sort((a, b) => severity(b) - severity(a))
    .slice(0, MAX_ORDER_WEATHER_WARNINGS);
}
