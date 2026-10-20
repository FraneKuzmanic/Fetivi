import { and, eq, gt, lt, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { units } from '../db/schema/properties';
import { pinAttempts, type SpaceRow, spaces } from '../db/schema/spaces';
import { stays } from '../db/schema/stays';
import type { GuestLanguage } from '../property/vocabulary';
import { hashToken, newToken } from '../tokens';
import { pinWaitMs } from './throttle';
import { PIN_LIMITS } from './vocabulary';

export class SpaceRuleError extends Error {
  override name = 'SpaceRuleError';
  constructor(readonly code: 'not-found' | 'invalid-input') {
    super(code);
  }
}

/** A unit with a QR slug; the slug exists only after approval, so the link is live. */
export async function findUnitBySlug(
  db: Db,
  slug: string,
): Promise<{ unitId: string; propertyId: string } | null> {
  const [row] = await db
    .select({ unitId: units.id, propertyId: units.propertyId })
    .from(units)
    .where(eq(units.qrSlug, slug));
  return row ?? null;
}

export type PinResult =
  | { ok: true; space: SpaceRow; token: string }
  | { ok: false; reason: 'wrong-pin' | 'throttled'; retryAfterMs: number };

/**
 * Checks a PIN typed on a unit's link. A match with an active Stay of that unit opens a new
 * Space, always a new row. Attempts on one property run one after the other under an advisory
 * lock (not the property row lock, so guessing never stalls a host's Stay edits). A throttled
 * attempt is refused before the PIN is looked at, and a wrong PIN and a PIN of an ended or
 * another unit's Stay look the same to the caller.
 */
export async function enterPin(
  db: Db,
  input: {
    slug: string;
    pin: string;
    language: GuestLanguage;
    deviceId: string;
    ip: string;
    now: Date;
  },
): Promise<PinResult> {
  const { pin, language, deviceId, ip, now } = input;
  return db.transaction(async (tx) => {
    const [unit] = await tx
      .select({ unitId: units.id, propertyId: units.propertyId })
      .from(units)
      .where(eq(units.qrSlug, input.slug));
    if (!unit) throw new SpaceRuleError('not-found');
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`pin:${unit.propertyId}`}, 0))`,
    );

    await tx
      .delete(pinAttempts)
      .where(
        and(
          lt(pinAttempts.createdAt, new Date(now.getTime() - PIN_LIMITS.keepMs)),
          or(
            eq(pinAttempts.propertyId, unit.propertyId),
            eq(pinAttempts.deviceId, deviceId),
            eq(pinAttempts.ip, ip),
          ),
        ),
      );

    const instants = async (where: ReturnType<typeof eq>, windowMs: number) =>
      (
        await tx
          .select({ at: pinAttempts.createdAt })
          .from(pinAttempts)
          .where(and(where, gt(pinAttempts.createdAt, new Date(now.getTime() - windowMs))))
      ).map((r) => r.at.getTime());
    const history = {
      device: await instants(eq(pinAttempts.deviceId, deviceId), PIN_LIMITS.device.windowMs),
      ip: await instants(eq(pinAttempts.ip, ip), PIN_LIMITS.ip.windowMs),
      property: await instants(
        eq(pinAttempts.propertyId, unit.propertyId),
        PIN_LIMITS.property.windowMs,
      ),
    };
    const wait = pinWaitMs(history, now.getTime());
    if (wait > 0) return { ok: false, reason: 'throttled', retryAfterMs: wait };

    const [stay] = await tx
      .select({ id: stays.id, activeUntil: stays.activeUntil })
      .from(stays)
      .where(and(eq(stays.unitId, unit.unitId), eq(stays.pin, pin), gt(stays.activeUntil, now)));

    if (!stay) {
      await tx
        .insert(pinAttempts)
        .values({ propertyId: unit.propertyId, deviceId, ip, createdAt: now });
      const t = now.getTime();
      const retryAfterMs = pinWaitMs(
        {
          device: [...history.device, t],
          ip: [...history.ip, t],
          property: [...history.property, t],
        },
        t,
      );
      return { ok: false, reason: 'wrong-pin', retryAfterMs };
    }

    const token = newToken();
    const [space] = await tx
      .insert(spaces)
      .values({
        stayId: stay.id,
        tokenHash: hashToken(token),
        language,
        closedAt: stay.activeUntil,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!space) throw new Error('insert returned no row');
    await tx.delete(pinAttempts).where(eq(pinAttempts.deviceId, deviceId));
    return { ok: true, space, token };
  });
}

export interface ResolvedSpace {
  space: SpaceRow;
  unitSlug: string;
  closed: boolean;
}

/** The Space behind a cookie token, or null. A Space whose Stay was deleted is gone with it. */
export async function resolveSpace(
  db: Db,
  token: string,
  now: Date,
): Promise<ResolvedSpace | null> {
  const [row] = await db
    .select({ space: spaces, unitSlug: units.qrSlug })
    .from(spaces)
    .innerJoin(stays, eq(stays.id, spaces.stayId))
    .innerJoin(units, eq(units.id, stays.unitId))
    .where(eq(spaces.tokenHash, hashToken(token)));
  if (!row?.unitSlug) return null;
  return { space: row.space, unitSlug: row.unitSlug, closed: now >= row.space.closedAt };
}

export async function setSpaceLanguage(
  db: Db,
  spaceId: string,
  language: GuestLanguage,
  now: Date,
): Promise<SpaceRow> {
  const [row] = await db
    .update(spaces)
    .set({ language, updatedAt: now })
    .where(eq(spaces.id, spaceId))
    .returning();
  if (!row) throw new SpaceRuleError('not-found');
  return row;
}
