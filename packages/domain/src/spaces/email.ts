import { and, eq, sql } from 'drizzle-orm';
import type { Db, Executor } from '../db/client';
import { spaces, spaceTokens } from '../db/schema/spaces';
import type { JobQueue } from '../jobs/queue';
import { enqueueSpaceEmail, spendSpaceToken } from './mail';
import { SpaceRuleError } from './store';

/** Stored trimmed and lower-case, so the same address typed twice is one address. */
export function normaliseSpaceEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface SpaceEmailState {
  /** Null unless the guest opted in. */
  email: string | null;
  verified: boolean;
  tips: boolean;
}

/**
 * The one email opt-in (first Order card or the update offer): confirmations, recovery and
 * updates. A new address clears verification and queues a link to confirm it, in the caller's
 * transaction. `tips: true` gives the separate daily-tip opt-in; otherwise it stays as it was.
 */
export async function optInSpaceEmail(
  tx: Executor,
  queue: JobQueue,
  input: { spaceId: string; email: string; now: Date; tips?: boolean },
): Promise<void> {
  const { spaceId, now } = input;
  const email = normaliseSpaceEmail(input.email);
  const [row] = await tx
    .select({ email: spaces.email })
    .from(spaces)
    .where(eq(spaces.id, spaceId))
    .for('update');
  if (!row) throw new SpaceRuleError('not-found');
  const changed = row.email !== email;
  await tx
    .update(spaces)
    .set({
      email,
      emailOptInAt: sql`coalesce(${spaces.emailOptInAt}, ${now})`,
      ...(changed ? { emailVerifiedAt: null } : {}),
      ...(input.tips === true
        ? { tipsEmailOptInAt: sql`coalesce(${spaces.tipsEmailOptInAt}, ${now})` }
        : {}),
      updatedAt: now,
    })
    .where(eq(spaces.id, spaceId));
  if (!changed) return;
  await tx
    .delete(spaceTokens)
    .where(and(eq(spaceTokens.spaceId, spaceId), eq(spaceTokens.purpose, 'verify_email')));
  await enqueueSpaceEmail(tx, queue, { purpose: 'verify_email', spaceId });
}

export async function spaceEmailState(db: Executor, spaceId: string): Promise<SpaceEmailState> {
  const [row] = await db
    .select({
      email: spaces.email,
      optedIn: spaces.emailOptInAt,
      verified: spaces.emailVerifiedAt,
      tips: spaces.tipsEmailOptInAt,
    })
    .from(spaces)
    .where(eq(spaces.id, spaceId));
  if (!row) throw new SpaceRuleError('not-found');
  const email = row.optedIn ? row.email : null;
  return { email, verified: email !== null && row.verified !== null, tips: row.tips !== null };
}

/** Locks the Space's row; `no-email` unless it has an opted-in email. */
export async function requireOptIn(tx: Executor, spaceId: string) {
  const [row] = await tx
    .select({ email: spaces.email, optedIn: spaces.emailOptInAt, verified: spaces.emailVerifiedAt })
    .from(spaces)
    .where(eq(spaces.id, spaceId))
    .for('update');
  if (!row) throw new SpaceRuleError('not-found');
  if (!row.email || !row.optedIn) throw new SpaceRuleError('no-email');
  return row;
}

/** The daily-tip opt-in, only next to an opted-in email. */
export async function setTipsOptIn(
  db: Db,
  spaceId: string,
  tips: boolean,
  now: Date,
): Promise<void> {
  await db.transaction(async (tx) => {
    await requireOptIn(tx, spaceId);
    await tx
      .update(spaces)
      .set({
        tipsEmailOptInAt: tips ? sql`coalesce(${spaces.tipsEmailOptInAt}, ${now})` : null,
        updatedAt: now,
      })
      .where(eq(spaces.id, spaceId));
  });
}

/** Queues another verification link; nothing when already verified. */
export async function resendVerification(db: Db, queue: JobQueue, spaceId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const row = await requireOptIn(tx, spaceId);
    if (row.verified) return;
    await enqueueSpaceEmail(tx, queue, { purpose: 'verify_email', spaceId });
  });
}

/**
 * Spends a verification token. The email is verified only if it is still the address the link
 * went to; a link for an older address is spent without verifying the new one.
 */
export async function verifySpaceEmail(db: Db, token: string, now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    const used = await spendSpaceToken(tx, { token, purpose: 'verify_email', now });
    await tx
      .update(spaces)
      .set({ emailVerifiedAt: sql`coalesce(${spaces.emailVerifiedAt}, ${now})`, updatedAt: now })
      .where(and(eq(spaces.id, used.spaceId), eq(spaces.email, used.email)));
  });
}
