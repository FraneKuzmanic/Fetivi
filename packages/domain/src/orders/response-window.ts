import { DateTime } from 'luxon';

/** ADR 0001: a card authorization must outlast the window, so it ends under 4 days. */
export const RESPONSE_WINDOW_CAP_HOURS = 96;

/** The Offer's response rule. `from`/`to` are 'HH:mm' or pg's 'HH:mm:ss'. */
export interface ResponseHours {
  windowMinutes: number;
  from: string;
  to: string;
}

const MINUTE_MS = 60_000;
// The CHECK on offers keeps the window under 4 response days, so 6 days always finish it.
const MAX_DAYS = 6;

function at(day: DateTime, hhmm: string): DateTime {
  return day.set({
    hour: Number(hhmm.slice(0, 2)),
    minute: Number(hhmm.slice(3, 5)),
    second: 0,
    millisecond: 0,
  });
}

/** Counts `windowMinutes` only between `from` and `to` each local day in `zone`, from `requestedAt`; never later than 96 h after it (ADR 0001). */
export function responseDueAt(requestedAt: Date, hours: ResponseHours, zone: string): Date {
  const cap = requestedAt.getTime() + RESPONSE_WINDOW_CAP_HOURS * 60 * MINUTE_MS;
  let cursor = DateTime.fromJSDate(requestedAt).setZone(zone);
  let left = hours.windowMinutes * MINUTE_MS;
  for (let i = 0; i < MAX_DAYS; i++) {
    const open = at(cursor, hours.from).toMillis();
    const close = at(cursor, hours.to).toMillis();
    // Epoch millis count a DST day in real minutes.
    const start = Math.max(cursor.toMillis(), open);
    if (start < close) {
      const take = Math.min(left, close - start);
      if (take === left) return new Date(Math.min(start + take, cap));
      left -= take;
    }
    cursor = cursor.plus({ days: 1 }).startOf('day');
  }
  return new Date(cap);
}
