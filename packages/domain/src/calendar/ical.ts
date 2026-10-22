import { DateTime, IANAZone } from 'luxon';
import type { CivilDate } from '../time';
import { CalendarFeedError } from './errors';
import { CALENDAR_LIMITS } from './vocabulary';

// A minimal RFC 5545 reader for the VEVENTs of Airbnb and Booking.com exports: line unfolding,
// parameters, DATE and DATE-TIME values, TEXT escapes. No RRULE or DURATION (neither uses them).

export interface ParsedEvent {
  uid: string;
  checkIn: CivilDate;
  /** DTEND, exclusive: the checkout date. */
  checkout: CivilDate;
  summary: string | null;
  cancelled: boolean;
}

interface ContentLine {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** Splits `NAME;PARAM=..:VALUE` at the first colon outside double quotes. */
function parseLine(line: string): ContentLine | null {
  let quoted = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === ':' && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;
  const [name = '', ...rawParams] = line.slice(0, colon).split(';');
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) };
}

const DATE = /^(\d{4})(\d{2})(\d{2})$/;
const DATE_TIME = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/;

/** A DATE or DATE-TIME value as a civil date in `zone` (DATE-TIMEs are converted). */
function civilDate(line: ContentLine, zone: string): CivilDate | null {
  const value = line.value.trim();
  const d = DATE.exec(value);
  if (d) {
    const iso = `${d[1]}-${d[2]}-${d[3]}`;
    return DateTime.fromISO(iso, { zone: 'UTC' }).isValid ? iso : null;
  }
  const t = DATE_TIME.exec(value);
  if (!t) return null;
  const tzid = line.params.TZID;
  const sourceZone = t[7] ? 'UTC' : tzid && IANAZone.isValidZone(tzid) ? tzid : zone;
  const instant = DateTime.fromObject(
    {
      year: Number(t[1]),
      month: Number(t[2]),
      day: Number(t[3]),
      hour: Number(t[4]),
      minute: Number(t[5]),
      second: Number(t[6]),
    },
    { zone: sourceZone },
  );
  if (!instant.isValid) return null;
  return instant.setZone(zone).toISODate();
}

function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? ' ' : c));
}

/**
 * The usable VEVENTs of an iCal file, with dates as civil dates in `zone`. Events without a
 * UID or valid dates are skipped; the last of duplicate UIDs wins. Throws CalendarFeedError
 * 'not-a-calendar' or 'too-large'.
 */
export function parseICal(text: string, zone: string): ParsedEvent[] {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n');
  if (!lines.some((l) => l.trim().toUpperCase() === 'BEGIN:VCALENDAR')) {
    throw new CalendarFeedError('not-a-calendar');
  }
  const events = new Map<string, ParsedEvent>();
  let count = 0;
  let current: ContentLine[] | null = null;
  // Nesting depth inside the VEVENT (VALARM and the like are skipped).
  let depth = 0;
  for (const raw of lines) {
    const line = parseLine(raw);
    if (!line) continue;
    const value = line.value.trim().toUpperCase();
    if (line.name === 'BEGIN') {
      if (current) depth++;
      else if (value === 'VEVENT') {
        if (++count > CALENDAR_LIMITS.maxEvents) throw new CalendarFeedError('too-large');
        current = [];
        depth = 0;
      }
      continue;
    }
    if (line.name === 'END' && current) {
      if (depth > 0) depth--;
      else {
        const event = toEvent(current, zone);
        if (event) {
          events.delete(event.uid);
          events.set(event.uid, event);
        }
        current = null;
      }
      continue;
    }
    if (current && depth === 0) current.push(line);
  }
  return [...events.values()];
}

function toEvent(lines: ContentLine[], zone: string): ParsedEvent | null {
  const get = (name: string) => lines.find((l) => l.name === name);
  const uid = get('UID')?.value.trim();
  const start = get('DTSTART');
  const end = get('DTEND');
  if (!uid || uid.length > CALENDAR_LIMITS.uidLength || !start || !end) return null;
  const checkIn = civilDate(start, zone);
  const checkout = civilDate(end, zone);
  if (!checkIn || !checkout || checkout <= checkIn) return null;
  const summaryLine = get('SUMMARY');
  const summary = summaryLine
    ? unescapeText(summaryLine.value).trim().slice(0, CALENDAR_LIMITS.summaryLength) || null
    : null;
  return {
    uid,
    checkIn,
    checkout,
    summary,
    cancelled: get('STATUS')?.value.trim().toUpperCase() === 'CANCELLED',
  };
}
