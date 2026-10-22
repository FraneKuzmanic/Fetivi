import {
  type CalendarSource,
  calendarSourcesOf,
  type Executor,
  needsPinWarning,
  properties,
  stayPhase,
  stays,
  toLocalDateTime,
  units,
} from '@fetivi/domain';
import { and, eq } from 'drizzle-orm';
import { HttpError } from '../http-error';
import { unitLink } from '../properties/qr';

// Reads and the response shape of a Stay, shared by the Stay and calendar routes.

/** A Stay with the unit and property fields its output needs. */
export const selectStays = (db: Executor) =>
  db
    .select({
      stay: stays,
      unitName: units.name,
      qrSlug: units.qrSlug,
      propertyId: properties.id,
      propertyName: properties.name,
      timezone: properties.timezone,
    })
    .from(stays)
    .innerJoin(units, eq(units.id, stays.unitId))
    .innerJoin(properties, eq(properties.id, units.propertyId));

export type StayJoin = Awaited<ReturnType<ReturnType<typeof selectStays>['execute']>>[number];

export interface StayOutContext {
  now: Date;
  guestOrigin: string;
}

function stayOut(row: StayJoin, calendarSources: CalendarSource[], ctx: StayOutContext) {
  const { stay, timezone } = row;
  return {
    id: stay.id,
    unitId: stay.unitId,
    unitName: row.unitName,
    propertyId: row.propertyId,
    propertyName: row.propertyName,
    timezone,
    checkIn: stay.checkIn,
    checkout: stay.checkout,
    partySize: stay.partySize,
    bookerName: stay.bookerName,
    reservationNumber: stay.reservationNumber,
    pin: stay.pin,
    arrivalReleaseAt: stay.arrivalReleaseAt.toISOString(),
    arrivalReleaseLocal: toLocalDateTime(stay.arrivalReleaseAt, timezone),
    activeUntil: stay.activeUntil.toISOString(),
    possiblyCancelled: stay.possiblyCancelled,
    calendarSources,
    pinSentAt: stay.pinSentAt?.toISOString() ?? null,
    handoverLanguage: stay.handoverLanguage,
    unitLink: row.qrSlug ? unitLink(ctx.guestOrigin, row.qrSlug) : null,
    phase: stayPhase(stay, timezone, ctx.now),
    pinWarning: needsPinWarning(stay, timezone, ctx.now),
    createdAt: stay.createdAt.toISOString(),
    updatedAt: stay.updatedAt.toISOString(),
  };
}

/** The output of each Stay, with the calendars it came from. */
export async function staysOut(db: Executor, rows: readonly StayJoin[], ctx: StayOutContext) {
  const sources = await calendarSourcesOf(
    db,
    rows.map((r) => r.stay.id),
  );
  return rows.map((r) => stayOut(r, sources.get(r.stay.id) ?? [], ctx));
}

export async function findOwnedStay(db: Executor, hostId: string, id: string): Promise<StayJoin> {
  const [row] = await selectStays(db).where(and(eq(stays.id, id), eq(properties.hostId, hostId)));
  if (!row) throw new HttpError(404, 'not-found');
  return row;
}

/** The output of one of the host's Stays. */
export async function ownedStayOut(db: Executor, hostId: string, id: string, ctx: StayOutContext) {
  const [out] = await staysOut(db, [await findOwnedStay(db, hostId, id)], ctx);
  if (!out) throw new HttpError(404, 'not-found');
  return out;
}
