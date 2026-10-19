import type { CookieSerializeOptions } from '@fastify/cookie';
import { accounts, type Db, sessions } from '@fetivi/domain';
import { eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Principal } from './access';
import { hashToken, newToken } from './tokens';

export const SESSION_COOKIE = '__Host-fetivi_session';

const DAY_MS = 24 * 60 * 60 * 1000;
export const IDLE_MS = 30 * DAY_MS;
export const ABSOLUTE_MS = 90 * DAY_MS;
export const SLIDE_AFTER_MS = 60 * 60 * 1000;

/** A database handle or an open transaction. */
export type Executor = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

/** Browsers drop a `__Host-` cookie, even a clearing one, without Secure and Path=/. */
export const clearCookieOptions: CookieSerializeOptions = {
  path: '/',
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
};

/** The server enforces idle expiry, so the cookie is set once and never rewritten on slide. */
export const sessionCookieOptions: CookieSerializeOptions = {
  ...clearCookieOptions,
  maxAge: ABSOLUTE_MS / 1000,
};

export async function createSession(
  db: Executor,
  accountId: string,
  now: Date,
): Promise<{ token: string; id: string }> {
  const token = newToken();
  const id = hashToken(token);
  await db.insert(sessions).values({
    id,
    accountId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: new Date(now.getTime() + IDLE_MS),
    absoluteExpiresAt: new Date(now.getTime() + ABSOLUTE_MS),
  });
  return { token, id };
}

const actingHost = alias(accounts, 'acting_host');

export async function resolveSession(db: Db, token: string, now: Date): Promise<Principal | null> {
  const id = hashToken(token);
  const [row] = await db
    .select({
      session: sessions,
      account: {
        id: accounts.id,
        email: accounts.email,
        role: accounts.role,
        suspendedAt: accounts.suspendedAt,
      },
      actingAs: { id: actingHost.id, email: actingHost.email },
    })
    .from(sessions)
    .innerJoin(accounts, eq(sessions.accountId, accounts.id))
    .leftJoin(actingHost, eq(sessions.actingAsHostId, actingHost.id))
    .where(eq(sessions.id, id));
  if (!row) return null;

  const { session, account } = row;
  const t = now.getTime();
  if (session.expiresAt.getTime() <= t || session.absoluteExpiresAt.getTime() <= t) {
    await deleteSession(db, id);
    return null;
  }
  // Suspending deletes the sessions too; this is the second line of defence.
  if (account.role === 'host' && account.suspendedAt) return null;

  if (t - session.lastSeenAt.getTime() > SLIDE_AFTER_MS) {
    const expiresAt = new Date(Math.min(t + IDLE_MS, session.absoluteExpiresAt.getTime()));
    await db.update(sessions).set({ lastSeenAt: now, expiresAt }).where(eq(sessions.id, id));
  }

  return {
    sessionId: id,
    account: { id: account.id, email: account.email, role: account.role },
    actingAs: row.actingAs?.id ? { id: row.actingAs.id, email: row.actingAs.email } : null,
  };
}

export async function deleteSession(db: Executor, id: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, id));
}

export async function deleteSessionsOf(db: Executor, accountId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.accountId, accountId));
}

export async function setActingAs(
  db: Executor,
  sessionId: string,
  hostId: string | null,
): Promise<void> {
  await db.update(sessions).set({ actingAsHostId: hostId }).where(eq(sessions.id, sessionId));
}
