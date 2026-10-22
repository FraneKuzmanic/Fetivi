import { DateTime } from 'luxon';
import type { GuestNotifyJobData } from '../notifications/guest/enqueue';
import { type CivilDate, startOfCivilDay } from '../time';
import type { WeatherWarning } from '../weather/source';
import { datesIn, type FerryNotice, linesIn } from './jadrolinija';
import type { AlertSpace } from './spaces';
import type { AffectedItem } from './vocabulary';

// Which Spaces a warning or a ferry notice touches, pure. Nothing here ever decides that a sailing
// is cancelled: the facts carry the source's own words and the line ids, nothing more.

/** By date, then time (any time last), then an Order before a suggestion. */
function byWhen(a: AffectedItem, b: AffectedItem): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.startTime !== b.startTime) {
    if (a.startTime === null) return 1;
    if (b.startTime === null) return -1;
    return a.startTime < b.startTime ? -1 : 1;
  }
  return (a.orderId ? 0 : 1) - (b.orderId ? 0 : 1);
}

const nextDay = (date: CivilDate, zone: string) =>
  DateTime.fromISO(date, { zone }).plus({ days: 1 }).toISODate() as CivilDate;

/**
 * One weather_warning job per warning in force during the Space's Stay (from the start of the
 * check-in day to the Space's close). The county and marine copies of a warning merge. A wind
 * warning names the first line-dependent item on a day it covers, for the sailing advisory.
 */
export function warningAlerts(
  warnings: readonly WeatherWarning[],
  space: AlertSpace,
  now: Date,
): GuestNotifyJobData[] {
  const stayStart = startOfCivilDay(space.checkIn, space.zone).getTime();
  const seen = new Set<string>();
  const jobs: GuestNotifyJobData[] = [];
  for (const w of warnings) {
    const onset = Date.parse(w.onset);
    const expires = Date.parse(w.expires);
    if (expires <= now.getTime() || onset >= space.closedAt.getTime() || expires <= stayStart) {
      continue;
    }
    const key = [w.type, w.level, w.onset, w.expires].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    const advisory =
      w.type === 'wind'
        ? ([...space.items].sort(byWhen).find((item) => {
            const dayStart = startOfCivilDay(item.date, space.zone).getTime();
            const dayEnd = startOfCivilDay(nextDay(item.date, space.zone), space.zone).getTime();
            return dayStart < expires && dayEnd > onset;
          }) ?? null)
        : null;
    jobs.push({
      kind: 'weather_warning',
      spaceId: space.spaceId,
      safety: {
        source: 'DHMZ',
        level: w.level,
        type: w.type,
        event: w.event,
        description: w.description,
        area: w.area,
        onset: w.onset,
        expires: w.expires,
        timezone: space.zone,
        advisory,
      },
    });
  }
  return jobs;
}

/**
 * One ferry_disruption job per Space with an item, today or later, on a day the notice covers and
 * on a line it names. The earliest such item is named. No line in the notice → no job.
 */
export function disruptionAlerts(
  notice: FerryNotice,
  spaces: readonly AlertSpace[],
  now: Date,
): GuestNotifyJobData[] {
  const noticeLines = linesIn(notice.text, 'jadrolinija');
  if (noticeLines.length === 0) return [];
  const days = datesIn(notice.text, notice.publishedLocal.slice(0, 10));
  const jobs: GuestNotifyJobData[] = [];
  for (const space of spaces) {
    const today = DateTime.fromJSDate(now, { zone: space.zone }).toISODate() as CivilDate;
    const item = [...space.items]
      .sort(byWhen)
      .find(
        (i) =>
          i.date >= today && days.includes(i.date) && i.lines.some((l) => noticeLines.includes(l)),
      );
    if (!item) continue;
    jobs.push({
      kind: 'ferry_disruption',
      spaceId: space.spaceId,
      safety: {
        source: 'Jadrolinija',
        noticeId: notice.id,
        title: notice.title,
        url: notice.url,
        timezone: space.zone,
        affected: { ...item, lines: item.lines.filter((l) => noticeLines.includes(l)) },
      },
    });
  }
  return jobs;
}
