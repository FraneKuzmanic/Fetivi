import { and, desc, eq, gt, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { pushSubscriptions } from '../db/schema/notifications';
import { units } from '../db/schema/properties';
import { type SpaceRow, spaces, spaceTokens } from '../db/schema/spaces';
import { stays } from '../db/schema/stays';
import type { JobQueue } from '../jobs/queue';
import { hashToken, newToken } from '../tokens';
import { normaliseSpaceEmail } from './email';
import { enqueueSpaceEmail } from './mail';
import { findUnitBySlug, SpaceRuleError } from './store';
import { SPACE_READ_ONLY_DAYS } from './vocabulary';

const READ_ONLY_MS = SPACE_READ_ONLY_DAYS * 24 * 60 * 60_000;

/**
 * A recovery request from a unit's PIN screen. Queues a link for the latest-created opted-in
 * Space of that unit with this email, still inside the read-only period. The caller learns
 * nothing about whether one matched; an unknown slug is `not-found`.
 */
export async function requestRecoveryBySlug(
  db: Db,
  queue: JobQueue,
  input: { slug: string; email: string; now: Date },
): Promise<void> {
  const unit = await findUnitBySlug(db, input.slug);
  if (!unit) throw new SpaceRuleError('not-found');
  const [match] = await db
    .select({ id: spaces.id })
    .from(spaces)
    .innerJoin(stays, eq(stays.id, spaces.stayId))
    .where(
      and(
        eq(stays.unitId, unit.unitId),
        eq(spaces.email, normaliseSpaceEmail(input.email)),
        isNotNull(spaces.emailOptInAt),
        gt(spaces.closedAt, new Date(input.now.getTime() - READ_ONLY_MS)),
      ),
    )
    .orderBy(desc(spaces.createdAt))
    .limit(1);
  if (!match) return;
  await db.transaction((tx) =>
    enqueueSpaceEmail(tx, queue, { purpose: 'recover', spaceId: match.id }),
  );
}

/** A recovery link asked for from Settings, to open this Space on another device. */
export async function requestRecoveryForSpace(
  db: Db,
  queue: JobQueue,
  input: { spaceId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ email: spaces.email, optedIn: spaces.emailOptInAt })
      .from(spaces)
      .where(eq(spaces.id, input.spaceId));
    if (!row) throw new SpaceRuleError('not-found');
    if (!row.email || !row.optedIn) throw new SpaceRuleError('no-email');
    await enqueueSpaceEmail(tx, queue, { purpose: 'recover', spaceId: input.spaceId });
  });
}

export interface RestoredSpace {
  space: SpaceRow;
  unitSlug: string;
  closed: boolean;
  /** The new cookie token; the old device's cookie stops working (ADR 0009). */
  cookieToken: string;
}

/**
 * Spends a recovery token and moves the Space to the device that opened the link: the cookie
 * token rotates and the old device's push subscriptions go. The Space keeps its Stay. Works
 * until the read-only period ends; a deleted Space's tokens are gone with it.
 */
export async function restoreSpace(
  db: Db,
  input: { token: string; now: Date },
): Promise<RestoredSpace> {
  const { now } = input;
  return db.transaction(async (tx) => {
    const [used] = await tx
      .delete(spaceTokens)
      .where(
        and(
          eq(spaceTokens.tokenHash, hashToken(input.token)),
          eq(spaceTokens.purpose, 'recover'),
          gt(spaceTokens.expiresAt, now),
        ),
      )
      .returning({ spaceId: spaceTokens.spaceId, email: spaceTokens.email });
    if (!used) throw new SpaceRuleError('invalid-token');

    const [found] = await tx
      .select({ closedAt: spaces.closedAt, unitSlug: units.qrSlug })
      .from(spaces)
      .innerJoin(stays, eq(stays.id, spaces.stayId))
      .innerJoin(units, eq(units.id, stays.unitId))
      .where(eq(spaces.id, used.spaceId))
      .for('update', { of: spaces });
    if (!found?.unitSlug || now.getTime() >= found.closedAt.getTime() + READ_ONLY_MS) {
      throw new SpaceRuleError('invalid-token');
    }

    const cookieToken = newToken();
    // Opening the link proves the address, so it counts as verified while it is still current.
    const [space] = await tx
      .update(spaces)
      .set({
        tokenHash: hashToken(cookieToken),
        emailVerifiedAt: sql`case when ${spaces.email} = ${used.email} then coalesce(${spaces.emailVerifiedAt}, ${now}) else ${spaces.emailVerifiedAt} end`,
        updatedAt: now,
      })
      .where(eq(spaces.id, used.spaceId))
      .returning();
    if (!space) throw new SpaceRuleError('invalid-token');
    await tx
      .delete(spaceTokens)
      .where(and(eq(spaceTokens.spaceId, space.id), eq(spaceTokens.purpose, 'recover')));
    await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.spaceId, space.id));
    return { space, unitSlug: found.unitSlug, closed: now >= space.closedAt, cookieToken };
  });
}
