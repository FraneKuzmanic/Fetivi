import { and, eq, gt, gte, lt, lte, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type { Executor } from '../../db/client';
import { properties, units } from '../../db/schema/properties';
import { spaces } from '../../db/schema/spaces';
import { stays } from '../../db/schema/stays';
import { type CivilDate, fromLocalDateTime } from '../../time';
import type { GuestNotifyJobData } from './enqueue';
import { EVENING_REMINDER_TIME } from './vocabulary';

// When the evening-before reminders go out, and which Stay notices are due. The cron reads current
// Stay data each run, so a changed date needs no rescheduling; the job id and the ledger make a
// repeated or caught-up run send nothing twice.

/** A missed cron slot still sends within this window; an older notice is no longer useful. */
export const CATCH_UP_MS = 24 * 60 * 60 * 1000;

function eveningBefore(date: CivilDate, zone: string): Date {
  const before = DateTime.fromISO(date, { zone }).minus({ days: 1 }).toISODate();
  if (!before) throw new Error(`invalid date: ${date}`);
  return fromLocalDateTime(`${before}T${EVENING_REMINDER_TIME}`, zone);
}

/** 18:00 property time the evening before a booked item's date. */
export function orderReminderAt(date: CivilDate, zone: string): Date {
  return eveningBefore(date, zone);
}

/** 18:00 property time the evening before checkout day. */
export function checkoutReminderAt(checkout: CivilDate, zone: string): Date {
  return eveningBefore(checkout, zone);
}

/**
 * The arrival and checkout notices due at `now`, within the catch-up window. A space opened after
 * the notice's instant gets none (the guest already sees the Guide), nor does a closed space or a
 * possibly cancelled Stay.
 */
export async function dueStayNotices(db: Executor, now: Date): Promise<GuestNotifyJobData[]> {
  const windowStart = new Date(now.getTime() - CATCH_UP_MS);
  const arrivals = await db
    .select({ spaceId: spaces.id })
    .from(spaces)
    .innerJoin(stays, eq(stays.id, spaces.stayId))
    .where(
      and(
        lte(stays.arrivalReleaseAt, now),
        gt(stays.arrivalReleaseAt, windowStart),
        lt(spaces.createdAt, stays.arrivalReleaseAt),
        gt(spaces.closedAt, now),
        eq(stays.possiblyCancelled, false),
      ),
    );

  // Any zone's "evening before checkout" falls within a day either side of the UTC date.
  const today = DateTime.fromJSDate(now, { zone: 'utc' });
  const candidates = await db
    .select({
      spaceId: spaces.id,
      createdAt: spaces.createdAt,
      checkout: stays.checkout,
      zone: properties.timezone,
    })
    .from(spaces)
    .innerJoin(stays, eq(stays.id, spaces.stayId))
    .innerJoin(units, eq(units.id, stays.unitId))
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .where(
      and(
        gte(stays.checkout, sql`${today.minus({ days: 1 }).toISODate()}::date`),
        lte(stays.checkout, sql`${today.plus({ days: 2 }).toISODate()}::date`),
        gt(spaces.closedAt, now),
        eq(stays.possiblyCancelled, false),
      ),
    );
  const checkouts = candidates.filter((c) => {
    const at = checkoutReminderAt(c.checkout, c.zone);
    return at <= now && at > windowStart && c.createdAt < at;
  });

  return [
    ...arrivals.map((a) => ({ kind: 'arrival_details' as const, spaceId: a.spaceId })),
    ...checkouts.map((c) => ({ kind: 'checkout_reminder' as const, spaceId: c.spaceId })),
  ];
}
