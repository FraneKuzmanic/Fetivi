import { DateTime } from 'luxon';
import {
  arrivalReleaseAt,
  type CivilDate,
  endOfCheckoutDay,
  InvalidTimeInputError,
  startOfCivilDay,
} from '../time';
import { PIN_WARNING_DAYS, STAY_LIMITS } from './vocabulary';

export class StayRuleError extends Error {
  override name = 'StayRuleError';
  constructor(
    readonly code:
      | 'not-found'
      | 'invalid-input'
      | 'unit-not-live'
      | 'account-suspended'
      | 'stay-ended',
  ) {
    super(code);
  }
}

export interface StayTimes {
  arrivalReleaseAt: Date;
  activeUntil: Date;
}

/** Derived instants of a Stay in its property's zone. */
export function stayTimes(
  s: { checkIn: CivilDate; checkout: CivilDate },
  zone: string,
  releaseDaysBefore: number,
): StayTimes {
  return {
    arrivalReleaseAt: arrivalReleaseAt(s.checkIn, zone, releaseDaysBefore),
    activeUntil: endOfCheckoutDay(s.checkout, zone),
  };
}

/** Active from registration until the end of checkout day. */
export const isActive = (s: { activeUntil: Date }, now: Date): boolean => now < s.activeUntil;

/** From 00:00 three days before check-in (property time) while the Stay is active and the PIN is not ticked as sent. */
export function needsPinWarning(
  s: { checkIn: CivilDate; activeUntil: Date; pinSentAt: Date | null },
  zone: string,
  now: Date,
): boolean {
  if (s.pinSentAt !== null || !isActive(s, now)) return false;
  // arrivalReleaseAt is "start of the day N days before check-in", which is exactly the warning start.
  return now >= arrivalReleaseAt(s.checkIn, zone, PIN_WARNING_DAYS);
}

export type StayPhase = 'upcoming' | 'in_stay' | 'ended';

export function stayPhase(
  s: { checkIn: CivilDate; activeUntil: Date },
  zone: string,
  now: Date,
): StayPhase {
  if (now < startOfCivilDay(s.checkIn, zone)) return 'upcoming';
  return isActive(s, now) ? 'in_stay' : 'ended';
}

/** Days between two civil dates, zone-free so DST does not matter. */
function daysBetween(from: CivilDate, to: CivilDate): number {
  return DateTime.fromISO(to, { zone: 'UTC' }).diff(DateTime.fromISO(from, { zone: 'UTC' }), 'days')
    .days;
}

/**
 * Throws StayRuleError('invalid-input') unless: checkout after check-in, at most 90 nights, the end
 * of checkout day is after now, check-in at most 730 days after today (property time). A check-in
 * in the past is allowed (the guest may already be there).
 */
export function assertStayDates(
  s: { checkIn: CivilDate; checkout: CivilDate },
  zone: string,
  now: Date,
): void {
  try {
    startOfCivilDay(s.checkIn, zone);
    const end = endOfCheckoutDay(s.checkout, zone);
    const nights = daysBetween(s.checkIn, s.checkout);
    const today = DateTime.fromJSDate(now, { zone }).toISODate() as CivilDate;
    if (
      nights < 1 ||
      nights > STAY_LIMITS.maxNights ||
      end <= now ||
      daysBetween(today, s.checkIn) > STAY_LIMITS.maxDaysAhead
    ) {
      throw new StayRuleError('invalid-input');
    }
  } catch (error) {
    if (error instanceof InvalidTimeInputError) throw new StayRuleError('invalid-input');
    throw error;
  }
}
