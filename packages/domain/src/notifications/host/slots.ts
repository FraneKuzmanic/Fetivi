import { DateTime } from 'luxon';
import type { CivilDate } from '../../time';

// When a host's digest is due. Times are wall-clock 'HH:MM' in the host's property timezone; the
// cron sends the latest slot at or before now, so a missed run catches up without repeating.

const HALF_DAY_MS = 12 * 60 * 60 * 1000;

/**
 * The instant of `time` on `date` in `zone`. Unlike `fromLocalDateTime` this never throws on a
 * DST gap: a spring-forward time moves forward (02:30 → 03:30) and that slot is kept. In a
 * fall-back overlap it is the earlier of the two instants, so the time is still one slot.
 *
 * Luxon alone is not used for this: it resolves an ambiguous or missing time from the zone's
 * offset at the real "now", so its answer would change with the season the code runs in. Here the
 * two offsets around the slot are tried, and the earliest instant that shows this wall time wins.
 */
export function digestSlotAt(date: CivilDate, time: string, zone: string): Date {
  const wall = DateTime.fromISO(`${date}T${time}`, { zone: 'utc' });
  if (!wall.isValid || !DateTime.local().setZone(zone).isValid) {
    throw new Error(`invalid digest slot: ${date}T${time} ${zone}`);
  }
  const offsetAt = (ms: number) => DateTime.fromMillis(ms, { zone }).offset;
  const before = offsetAt(wall.toMillis() - HALF_DAY_MS);
  const after = offsetAt(wall.toMillis() + HALF_DAY_MS);
  const label = wall.toFormat("yyyy-MM-dd'T'HH:mm");
  const shows = (ms: number) =>
    DateTime.fromMillis(ms, { zone }).toFormat("yyyy-MM-dd'T'HH:mm") === label;
  const candidates = [before, after]
    .map((offset) => wall.toMillis() - offset * 60_000)
    .filter(shows)
    .sort((a, b) => a - b);
  // No candidate shows the time: it is in a spring-forward gap, so read it with the offset from
  // before the change, which lands that far past the gap.
  return new Date(candidates[0] ?? wall.toMillis() - before * 60_000);
}

/** The latest digest slot at or before `now`, from today's and yesterday's times in `zone`. */
export function dueDigestSlot(times: readonly string[], zone: string, now: Date): Date | null {
  const today = DateTime.fromJSDate(now, { zone });
  const days = [today.toISODate(), today.minus({ days: 1 }).toISODate()];
  let latest: Date | null = null;
  for (const day of days) {
    if (!day) continue;
    for (const time of times) {
      const slot = digestSlotAt(day, time, zone);
      if (slot.getTime() <= now.getTime() && (!latest || slot.getTime() > latest.getTime())) {
        latest = slot;
      }
    }
  }
  return latest;
}
