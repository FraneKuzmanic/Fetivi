import { and, eq, gt } from 'drizzle-orm';
import { type Db, type Executor, pgCode } from '../db/client';
import { accounts } from '../db/schema/accounts';
import { properties, units } from '../db/schema/properties';
import { spaces } from '../db/schema/spaces';
import { type StayRow, stays } from '../db/schema/stays';
import type { GuestLanguage } from '../property/vocabulary';
import type { CivilDate } from '../time';
import { type PinSource, randomPin } from './pin';
import { assertStayDates, isActive, StayRuleError, stayTimes } from './rules';

// The one write path for Stays. Calendar sync (22) registers and moves Stays through these too,
// so the property lock and the live rule always hold.

export interface StayInput {
  checkIn: CivilDate;
  checkout: CivilDate;
  partySize: number;
  bookerName?: string | null;
  reservationNumber?: string | null;
  handoverLanguage?: GuestLanguage;
}

export type StayChanges = Partial<StayInput> & { pinSent?: boolean };

/** Practically unreachable: a property has tens of active Stays among 10⁶ PINs. */
const MAX_PIN_DRAWS = 50;

/** A violated CHECK (23514) is invalid input. */
async function withStayChecks<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (pgCode(error) === '23514') throw new StayRuleError('invalid-input');
    throw error;
  }
}

interface UnitContext {
  unitId: string;
  propertyId: string;
  qrSlug: string | null;
  arrivalReleaseDaysBefore: number;
  timezone: string;
  approvedAt: Date | null;
  suspendedAt: Date | null;
}

/**
 * Loads unit, property and host account for a Stay write and locks the property row FOR UPDATE,
 * so all PIN draws of one property (across its units) run one after the other. The unit row is
 * then read FOR UPDATE too (property first, the same order as deletes cascade), so a release
 * offset change still in flight is waited for instead of being copied stale into the Stay.
 */
async function lockUnitContext(tx: Executor, unitId: string): Promise<UnitContext> {
  const [owner] = await tx
    .select({ propertyId: units.propertyId })
    .from(units)
    .where(eq(units.id, unitId));
  if (!owner) throw new StayRuleError('not-found');
  const [property] = await tx
    .select({
      timezone: properties.timezone,
      approvedAt: properties.approvedAt,
      hostId: properties.hostId,
    })
    .from(properties)
    .where(eq(properties.id, owner.propertyId))
    .for('update');
  if (!property) throw new StayRuleError('not-found');
  const [unit] = await tx
    .select({
      propertyId: units.propertyId,
      qrSlug: units.qrSlug,
      arrivalReleaseDaysBefore: units.arrivalReleaseDaysBefore,
    })
    .from(units)
    .where(eq(units.id, unitId))
    .for('update');
  if (!unit) throw new StayRuleError('not-found');
  const [host] = await tx
    .select({ suspendedAt: accounts.suspendedAt })
    .from(accounts)
    .where(eq(accounts.id, property.hostId));
  return {
    unitId,
    ...unit,
    timezone: property.timezone,
    approvedAt: property.approvedAt,
    suspendedAt: host?.suspendedAt ?? null,
  };
}

/** Only live units (approved property, QR issued) of non-suspended hosts accept Stays. */
export function assertUnitLive(ctx: {
  approvedAt: Date | null;
  qrSlug: string | null;
  suspendedAt: Date | null;
}): void {
  if (ctx.suspendedAt) throw new StayRuleError('account-suspended');
  if (!ctx.approvedAt || !ctx.qrSlug) throw new StayRuleError('unit-not-live');
}

/** PINs of the property's Stays that are active now. Call with the property row locked. */
async function activePins(tx: Executor, propertyId: string, now: Date): Promise<Set<string>> {
  const rows = await tx
    .select({ pin: stays.pin })
    .from(stays)
    .innerJoin(units, eq(units.id, stays.unitId))
    .where(and(eq(units.propertyId, propertyId), gt(stays.activeUntil, now)));
  return new Set(rows.map((r) => r.pin));
}

export async function registerStay(
  db: Db,
  unitId: string,
  input: StayInput,
  now: Date,
  options: { pin?: PinSource } = {},
): Promise<StayRow> {
  return withStayChecks(() =>
    db.transaction(async (tx) => {
      const ctx = await lockUnitContext(tx, unitId);
      assertUnitLive(ctx);
      assertStayDates(input, ctx.timezone, now);
      const taken = await activePins(tx, ctx.propertyId, now);
      const draw = options.pin ?? randomPin;
      let pin: string | undefined;
      for (let i = 0; i < MAX_PIN_DRAWS && pin === undefined; i++) {
        const candidate = draw();
        if (!taken.has(candidate)) pin = candidate;
      }
      if (pin === undefined) throw new Error('no free PIN');
      const [row] = await tx
        .insert(stays)
        .values({
          unitId,
          checkIn: input.checkIn,
          checkout: input.checkout,
          partySize: input.partySize,
          bookerName: input.bookerName ?? null,
          reservationNumber: input.reservationNumber ?? null,
          handoverLanguage: input.handoverLanguage ?? 'en',
          pin,
          ...stayTimes(input, ctx.timezone, ctx.arrivalReleaseDaysBefore),
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!row) throw new Error('insert returned no row');
      return row;
    }),
  );
}

/**
 * Changes a Stay; the PIN and the unit never change. Edits cannot break PIN uniqueness: an active
 * Stay was unique against every Stay active at the same moment when it was registered, and ended
 * Stays cannot be edited, so no edit can revive an old PIN next to a newer one.
 */
export async function updateStay(
  db: Db,
  stayId: string,
  changes: StayChanges,
  now: Date,
): Promise<StayRow> {
  return withStayChecks(() =>
    db.transaction(async (tx) => {
      const [found] = await tx
        .select({ unitId: stays.unitId })
        .from(stays)
        .where(eq(stays.id, stayId));
      if (!found) throw new StayRuleError('not-found');
      const ctx = await lockUnitContext(tx, found.unitId);
      const [stay] = await tx.select().from(stays).where(eq(stays.id, stayId)).for('update');
      if (!stay) throw new StayRuleError('not-found');
      if (!isActive(stay, now)) throw new StayRuleError('stay-ended');
      const dates = {
        checkIn: changes.checkIn ?? stay.checkIn,
        checkout: changes.checkout ?? stay.checkout,
      };
      assertStayDates(dates, ctx.timezone, now);
      const pinSentAt =
        changes.pinSent === undefined
          ? stay.pinSentAt
          : changes.pinSent
            ? (stay.pinSentAt ?? now)
            : null;
      const [row] = await tx
        .update(stays)
        .set({
          ...dates,
          ...(changes.partySize !== undefined && { partySize: changes.partySize }),
          ...(changes.bookerName !== undefined && { bookerName: changes.bookerName }),
          ...(changes.reservationNumber !== undefined && {
            reservationNumber: changes.reservationNumber,
          }),
          ...(changes.handoverLanguage !== undefined && {
            handoverLanguage: changes.handoverLanguage,
          }),
          ...stayTimes(dates, ctx.timezone, ctx.arrivalReleaseDaysBefore),
          pinSentAt,
          updatedAt: now,
        })
        .where(eq(stays.id, stayId))
        .returning();
      if (!row) throw new StayRuleError('not-found');
      await tx
        .update(spaces)
        .set({ closedAt: row.activeUntil, updatedAt: now })
        .where(eq(spaces.stayId, stayId));
      return row;
    }),
  );
}

/**
 * Re-derives the instants of not-yet-ended Stays after the unit's release offset or the
 * property's zone changed. Run in the caller's transaction, after its update.
 */
export async function refreshStayTimes(
  tx: Executor,
  scope: { unitId: string } | { propertyId: string },
  now: Date,
): Promise<void> {
  const rows = await tx
    .select({
      id: stays.id,
      checkIn: stays.checkIn,
      checkout: stays.checkout,
      releaseDaysBefore: units.arrivalReleaseDaysBefore,
      timezone: properties.timezone,
    })
    .from(stays)
    .innerJoin(units, eq(units.id, stays.unitId))
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .where(
      and(
        'unitId' in scope ? eq(units.id, scope.unitId) : eq(properties.id, scope.propertyId),
        gt(stays.activeUntil, now),
      ),
    );
  for (const row of rows) {
    const times = stayTimes(row, row.timezone, row.releaseDaysBefore);
    await tx.update(stays).set(times).where(eq(stays.id, row.id));
    await tx
      .update(spaces)
      .set({ closedAt: times.activeUntil, updatedAt: now })
      .where(eq(spaces.stayId, row.id));
  }
}
