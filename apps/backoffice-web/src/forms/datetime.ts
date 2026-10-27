// Dates and times as the back office shows them: day first, 24-hour clock, whatever the browser's
// locale. Values stay ISO ("2026-10-27", "15:00") so the API sees what it always saw.

const pad = (n: number) => String(n).padStart(2, '0');

export const isoDate = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** A real calendar day, or null. */
function validDate(y: number, m: number, d: number): string | null {
  if (y < 1000 || y > 9999 || m < 1 || m > 12 || d < 1) return null;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d > last ? null : isoDate(y, m, d);
}

/**
 * What a host typed into a date field: "27.10.2026", "27/10/2026", "27-10-2026", "27.10." (this
 * year) or ISO "2026-10-27". Two-digit years mean 20xx. Null when it is not a real day.
 */
export function parseDate(text: string, thisYear: number): string | null {
  const t = text.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (iso) return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const dmy = /^(\d{1,2})[./\- ](\d{1,2})(?:[./\- ](\d{2}|\d{4})?)?\.?$/.exec(t);
  if (!dmy) return null;
  const rawYear = dmy[3];
  const year =
    rawYear === undefined ? thisYear : Number(rawYear) + (rawYear.length === 2 ? 2000 : 0);
  return validDate(year, Number(dmy[2]), Number(dmy[1]));
}

/** "2026-10-27" → "27.10.2026". */
export function formatDate(iso: string | null): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
}

/**
 * What a host typed into a time field: "15:00", "15.00", "1500", "15", "9:5" is not a time.
 * Null when it is not a time of day.
 */
export function parseTime(text: string): string | null {
  const t = text.trim();
  const m = /^(\d{1,2})(?:[:.h ]?(\d{2}))?$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] === undefined ? 0 : Number(m[2]);
  return h > 23 || min > 59 ? null : `${pad(h)}:${pad(min)}`;
}

/** Every half hour of the day, for the time field's list. */
export const HALF_HOURS: readonly string[] = Array.from(
  { length: 48 },
  (_, i) => `${pad(Math.floor(i / 2))}:${i % 2 ? '30' : '00'}`,
);

/** The weeks of a month, Monday first; null pads the days outside it. */
export function monthGrid(year: number, month: number): (string | null)[][] {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const lead = (first + 6) % 7;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: days }, (_, i) => isoDate(year, month, i + 1)),
  ];
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** The ISO day `n` days after `iso` (negative goes back). */
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d + n));
  return isoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/** The same day `n` months later, clamped to the month's last day. */
export function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const ty = target.getUTCFullYear();
  const tm = target.getUTCMonth() + 1;
  const last = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  return isoDate(ty, tm, Math.min(d, last));
}

/** Today in the browser's time zone, as an ISO day. */
export function todayIso(now = new Date()): string {
  return isoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}
