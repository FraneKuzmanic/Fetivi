import { DateTime } from 'luxon';
import type { CatalogOpeningHoursRow, CatalogSeasonRow } from '../db/schema/catalog';
import type { CivilDate } from '../time';

export interface MonthDay {
  month: number;
  day: number;
}

/** A civil date's month and day. */
export function monthDayOf(date: CivilDate): MonthDay {
  const [, month, day] = date.split('-').map(Number);
  return { month: month ?? 0, day: day ?? 0 };
}

type SeasonRange = Pick<CatalogSeasonRow, 'fromMonth' | 'fromDay' | 'toMonth' | 'toDay'>;

/** No rows = all year. A row whose from > to wraps the new year (11-01 to 03-31). Inclusive at both ends. */
export function inSeason(rows: SeasonRange[], on: MonthDay): boolean {
  if (rows.length === 0) return true;
  const d = on.month * 100 + on.day;
  return rows.some((r) => {
    const from = r.fromMonth * 100 + r.fromDay;
    const to = r.toMonth * 100 + r.toDay;
    return from <= to ? d >= from && d <= to : d >= from || d <= to;
  });
}

export type OpenState = 'open' | 'closed' | 'unknown';

type HoursRow = Pick<
  CatalogOpeningHoursRow,
  'weekday' | 'opens' | 'closes' | 'validFrom' | 'validTo'
>;

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.slice(0, 5).split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

const validOn = (r: HoursRow, date: CivilDate) =>
  (r.validFrom === null || r.validFrom <= date) && (r.validTo === null || r.validTo >= date);

/**
 * Whether a place is open at a wall-clock time on a civil date. Rows valid on that date decide
 * (validFrom/validTo null = open-ended). No valid row for the date = 'unknown' (hours not
 * entered for that period). A row whose closes < opens runs past midnight: it covers
 * [opens, 24:00) on its weekday and [00:00, closes) on the next day (checked against the
 * previous date's validity).
 */
export function openStateAt(rows: HoursRow[], date: CivilDate, time: string): OpenState {
  const day = DateTime.fromISO(date);
  const previous = day.minus({ days: 1 }).toISODate() as string;
  const previousWeekday = day.minus({ days: 1 }).weekday;
  const t = minutesOf(time);

  const today = rows.filter((r) => validOn(r, date));
  const spill = rows.filter(
    (r) =>
      validOn(r, previous) &&
      r.weekday === previousWeekday &&
      minutesOf(r.closes) < minutesOf(r.opens),
  );
  if (today.length === 0 && spill.length === 0) return 'unknown';

  const openToday = today.some((r) => {
    if (r.weekday !== day.weekday) return false;
    const opens = minutesOf(r.opens);
    const closes = minutesOf(r.closes);
    return closes > opens ? t >= opens && t < closes : t >= opens;
  });
  const openFromYesterday = spill.some((r) => t < minutesOf(r.closes));
  return openToday || openFromYesterday ? 'open' : 'closed';
}
