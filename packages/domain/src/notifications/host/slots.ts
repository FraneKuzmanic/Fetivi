import { DateTime } from 'luxon';
import type { CivilDate } from '../../time';

// When a host's digest is due. Times are wall-clock 'HH:MM' in the host's property timezone; the
// cron sends the latest slot at or before now, so a missed run catches up without repeating.

/**
 * The instant of `time` on `date` in `zone`. Unlike `fromLocalDateTime` this never throws on a
 * DST gap: Luxon moves a spring-forward time forward (02:30 → 03:30) and that slot is kept. In a
 * fall-back overlap Luxon picks the earlier offset, so the time is still one slot.
 */
export function digestSlotAt(date: CivilDate, time: string, zone: string): Date {
  const slot = DateTime.fromISO(`${date}T${time}`, { zone });
  if (!slot.isValid) throw new Error(`invalid digest slot: ${date}T${time} ${zone}`);
  return slot.toJSDate();
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
