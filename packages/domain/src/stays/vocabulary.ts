// Stay limits and patterns. Imports nothing: the back-office SPA bundles this file through the
// `@fetivi/domain/stay-vocabulary` subpath.

/** Six digits, leading zeros allowed. */
export const PIN_PATTERN = /^\d{6}$/;

/** The "PIN not sent" warning starts at 00:00 this many days before check-in, property time. */
export const PIN_WARNING_DAYS = 3;

export const STAY_LIMITS = {
  partySize: { min: 1, max: 50 },
  /** Nights from check-in to checkout. */
  maxNights: 90,
  /** How far ahead check-in may be, in days. */
  maxDaysAhead: 730,
  bookerName: 120,
  reservationNumber: 64,
} as const;
