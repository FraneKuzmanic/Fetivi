import { and, eq, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type { Db } from '../db/client';
import { type AllotmentSlotRow, allotmentSlots } from '../db/schema/offers';
import { type CivilDate, fromLocalDateTime, InvalidTimeInputError } from '../time';
import { lockOffer, OfferRuleError, withOfferChecks } from './store';
import { OFFER_LIMITS } from './vocabulary';

export interface WeeklySchedule {
  from: CivilDate;
  to: CivilDate;
  /** ISO weekdays, 1 = Monday … 7 = Sunday. */
  weekdays: number[];
  /** 'HH:MM' wall-clock times in the destination's zone. */
  times: string[];
}

/**
 * The instants of a weekly schedule, sorted. Walks civil dates (DST days are 23 or 25 hours), and
 * skips a time that does not exist on a spring-forward day.
 */
export function expandWeeklySchedule(
  schedule: WeeklySchedule,
  zone: string,
): { startsAt: Date[]; skipped: number } {
  const startsAt: Date[] = [];
  let skipped = 0;
  const last = DateTime.fromISO(schedule.to, { zone });
  for (
    let day = DateTime.fromISO(schedule.from, { zone });
    day <= last;
    day = day.plus({ days: 1 }).startOf('day')
  ) {
    if (!schedule.weekdays.includes(day.weekday)) continue;
    const date = day.toISODate();
    for (const time of schedule.times) {
      try {
        startsAt.push(fromLocalDateTime(`${date}T${time}`, zone));
      } catch (error) {
        if (!(error instanceof InvalidTimeInputError)) throw error;
        skipped += 1;
      }
    }
  }
  startsAt.sort((a, b) => a.getTime() - b.getTime());
  return { startsAt, skipped };
}

/**
 * Adds slots to an allotment Offer. Past instants and instants that already have a slot are
 * skipped and counted.
 */
export async function addAllotmentSlots(
  db: Db,
  offerId: string,
  startsAt: Date[],
  capacity: number,
  now: Date,
): Promise<{ created: number; skipped: number }> {
  if (startsAt.length > OFFER_LIMITS.slotsPerBulk) throw new OfferRuleError('invalid-input');
  return withOfferChecks(() =>
    db.transaction(async (tx) => {
      const offer = await lockOffer(tx, offerId);
      if (offer.availabilityMode !== 'allotment') throw new OfferRuleError('invalid-input');
      const future = startsAt.filter((t) => t >= now);
      if (future.length === 0) return { created: 0, skipped: startsAt.length };
      const rows = await tx
        .insert(allotmentSlots)
        .values(future.map((t) => ({ offerId, startsAt: t, capacity, remaining: capacity })))
        .onConflictDoNothing({ target: [allotmentSlots.offerId, allotmentSlots.startsAt] })
        .returning({ id: allotmentSlots.id });
      return { created: rows.length, skipped: startsAt.length - rows.length };
    }),
  );
}

async function slotExists(db: Db, slotId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: allotmentSlots.id })
    .from(allotmentSlots)
    .where(eq(allotmentSlots.id, slotId));
  return row !== undefined;
}

/** Sets a slot's capacity, keeping the seats already taken. One statement, so no stale read. */
export async function setSlotCapacity(
  db: Db,
  slotId: string,
  capacity: number,
): Promise<AllotmentSlotRow> {
  const [slot] = await withOfferChecks(() =>
    db
      .update(allotmentSlots)
      .set({
        remaining: sql`${allotmentSlots.remaining} + (${capacity} - ${allotmentSlots.capacity})`,
        capacity,
      })
      .where(
        and(
          eq(allotmentSlots.id, slotId),
          sql`${allotmentSlots.capacity} - ${allotmentSlots.remaining} <= ${capacity}`,
        ),
      )
      .returning(),
  );
  if (slot) return slot;
  throw new OfferRuleError((await slotExists(db, slotId)) ? 'seats-taken' : 'not-found');
}

/** Deletes a slot while none of its seats is taken. */
export async function deleteSlot(db: Db, slotId: string): Promise<void> {
  const [row] = await db
    .delete(allotmentSlots)
    .where(
      and(eq(allotmentSlots.id, slotId), eq(allotmentSlots.remaining, allotmentSlots.capacity)),
    )
    .returning({ id: allotmentSlots.id });
  if (row) return;
  throw new OfferRuleError((await slotExists(db, slotId)) ? 'seats-taken' : 'not-found');
}
