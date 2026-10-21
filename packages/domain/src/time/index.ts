import { DateTime, IANAZone } from 'luxon';

/** A calendar date with no time or zone, 'YYYY-MM-DD'. Stay dates are civil dates. */
export type CivilDate = string;

export class InvalidTimeInputError extends Error {
  override name = 'InvalidTimeInputError';
}

const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function assertValidZone(zone: string): void {
  if (!IANAZone.isValidZone(zone)) {
    throw new InvalidTimeInputError(`Invalid IANA zone: ${zone}`);
  }
}

function civilDayStart(date: CivilDate, zone: string): DateTime {
  assertValidZone(zone);
  if (!CIVIL_DATE.test(date)) {
    throw new InvalidTimeInputError(`Not a civil date (YYYY-MM-DD): ${date}`);
  }
  const start = DateTime.fromISO(date, { zone }).startOf('day');
  if (!start.isValid) {
    throw new InvalidTimeInputError(`Invalid civil date: ${date}`);
  }
  return start;
}

// Day arithmetic moves the civil date, then takes the start of that day again,
// so a DST change never shifts the result by an hour.
function shiftDays(date: CivilDate, days: number, zone: string): Date {
  return civilDayStart(date, zone).plus({ days }).startOf('day').toJSDate();
}

export function startOfCivilDay(date: CivilDate, zone: string): Date {
  return civilDayStart(date, zone).toJSDate();
}

/** The start of the civil day after `date`. */
export function endOfCivilDay(date: CivilDate, zone: string): Date {
  return shiftDays(date, 1, zone);
}

/** The civil-day boundary after checkout day, not the accommodation's checkout time. */
export function endOfCheckoutDay(checkout: CivilDate, zone: string): Date {
  return shiftDays(checkout, 1, zone);
}

/** Start of the day `daysBefore` days before check-in (0 to 7, default 1). */
export function arrivalReleaseAt(checkIn: CivilDate, zone: string, daysBefore = 1): Date {
  if (!Number.isInteger(daysBefore) || daysBefore < 0 || daysBefore > 7) {
    throw new InvalidTimeInputError(`daysBefore must be an integer from 0 to 7: ${daysBefore}`);
  }
  return shiftDays(checkIn, -daysBefore, zone);
}

/** 'YYYY-MM-DDTHH:mm', the wall-clock form `fromLocalDateTime` accepts. */
export const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const LOCAL_FORMAT = "yyyy-LL-dd'T'HH:mm";

/** 'YYYY-MM-DDTHH:mm' as wall-clock time in `zone` → the instant. Throws on a bad value or a DST gap. */
export function fromLocalDateTime(local: string, zone: string): Date {
  assertValidZone(zone);
  if (!LOCAL_DATETIME.test(local)) {
    throw new InvalidTimeInputError(`Not a local date-time (YYYY-MM-DDTHH:mm): ${local}`);
  }
  const parsed = DateTime.fromISO(local, { zone });
  // Luxon moves a time in a spring-forward gap; a changed wall-clock value means it did not exist.
  if (!parsed.isValid || parsed.toFormat(LOCAL_FORMAT) !== local) {
    throw new InvalidTimeInputError(`Invalid or non-existent local time: ${local}`);
  }
  return parsed.toJSDate();
}

/** The instant as 'YYYY-MM-DDTHH:mm' wall-clock time in `zone`. */
export function toLocalDateTime(instant: Date, zone: string): string {
  assertValidZone(zone);
  return DateTime.fromJSDate(instant, { zone }).toFormat(LOCAL_FORMAT);
}
