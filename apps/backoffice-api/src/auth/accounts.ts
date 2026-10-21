import {
  accounts,
  accountTokens,
  type Db,
  type Executor,
  hashToken,
  type Mailer,
  newToken,
} from '@fetivi/domain';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { HttpError } from '../http-error';
import type { Principal } from './access';
import { hashPassword, verifyAgainstDummy, verifyPassword } from './passwords';
import { createSession, deleteSessionsOf } from './sessions';
import { clearFailures, isThrottled, recordFailure } from './throttle';

export const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
export const RESET_TTL_MS = 60 * 60 * 1000;
export const MAX_EMAILS_PER_HOUR = 3;

/** Normalised before validation, so surrounding spaces and capitals are accepted. */
export const Email = z
  .string()
  .transform((value) => normaliseEmail(value))
  .pipe(z.email().max(254));

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface AccountDeps {
  db: Db;
  mailer: Mailer;
  webOrigin: string;
  now: () => Date;
}

type Purpose = 'verify_email' | 'reset_password';
type Account = typeof accounts.$inferSelect;

async function findByEmail(db: Db, email: string): Promise<Account | undefined> {
  const [account] = await db.select().from(accounts).where(eq(accounts.email, email));
  return account;
}

/** Creates a token and returns it, or null when the account already got enough mail this hour. */
async function issueToken(deps: AccountDeps, accountId: string, purpose: Purpose) {
  const now = deps.now();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const [row] = await deps.db
    .select({ n: sql<number>`count(*)::int` })
    .from(accountTokens)
    .where(
      and(
        eq(accountTokens.accountId, accountId),
        eq(accountTokens.purpose, purpose),
        gt(accountTokens.createdAt, hourAgo),
      ),
    );
  if ((row?.n ?? 0) >= MAX_EMAILS_PER_HOUR) return null;

  const token = newToken();
  const ttl = purpose === 'verify_email' ? VERIFY_TTL_MS : RESET_TTL_MS;
  await deps.db.insert(accountTokens).values({
    tokenHash: hashToken(token),
    accountId,
    purpose,
    createdAt: now,
    expiresAt: new Date(now.getTime() + ttl),
  });
  return token;
}

async function sendVerification(deps: AccountDeps, account: Account): Promise<void> {
  const token = await issueToken(deps, account.id, 'verify_email');
  if (!token) return;
  await deps.mailer.send({
    to: account.email,
    subject: 'Confirm your Fetivi email address',
    text: `Open this link to confirm your email address. It works for 24 hours.\n\n${deps.webOrigin}/verify-email?token=${token}`,
  });
}

async function sendReset(deps: AccountDeps, account: Account, alreadyRegistered: boolean) {
  const token = await issueToken(deps, account.id, 'reset_password');
  if (!token) return;
  const intro = alreadyRegistered
    ? 'Someone tried to sign up with this email address, but you already have a Fetivi account. If you forgot your password, reset it here.'
    : 'Open this link to choose a new password.';
  await deps.mailer.send({
    to: account.email,
    subject: alreadyRegistered ? 'You already have a Fetivi account' : 'Reset your Fetivi password',
    text: `${intro} The link works for 1 hour.\n\n${deps.webOrigin}/reset-password?token=${token}`,
  });
}

/** Consumes a token in the given transaction; single use even under concurrency. */
async function consumeToken(tx: Executor, token: string, purpose: Purpose, now: Date) {
  const [row] = await tx
    .delete(accountTokens)
    .where(
      and(
        eq(accountTokens.tokenHash, hashToken(token)),
        eq(accountTokens.purpose, purpose),
        gt(accountTokens.expiresAt, now),
      ),
    )
    .returning({ accountId: accountTokens.accountId });
  if (!row) throw new HttpError(400, 'invalid-token');
  return row.accountId;
}

/** Answers the same way whether or not the email is known. */
export async function signUp(deps: AccountDeps, email: string, password: string): Promise<void> {
  const existing = await findByEmail(deps.db, email);
  if (!existing) {
    const [account] = await deps.db
      .insert(accounts)
      .values({ email, passwordHash: await hashPassword(password), role: 'host' })
      .onConflictDoNothing()
      .returning();
    // A concurrent sign-up for the same email won the race; it sends its own mail.
    if (account) await sendVerification(deps, account);
    return;
  }
  if (!existing.emailVerifiedAt) return sendVerification(deps, existing);
  return sendReset(deps, existing, true);
}

export async function verifyEmail(deps: AccountDeps, token: string): Promise<void> {
  const now = deps.now();
  await deps.db.transaction(async (tx) => {
    const accountId = await consumeToken(tx, token, 'verify_email', now);
    await tx
      .update(accounts)
      .set({ emailVerifiedAt: now, updatedAt: now })
      .where(and(eq(accounts.id, accountId), isNull(accounts.emailVerifiedAt)));
    await tx
      .delete(accountTokens)
      .where(
        and(eq(accountTokens.accountId, accountId), eq(accountTokens.purpose, 'verify_email')),
      );
  });
}

export async function resendVerification(deps: AccountDeps, email: string): Promise<void> {
  const account = await findByEmail(deps.db, email);
  if (account && !account.emailVerifiedAt) await sendVerification(deps, account);
}

export async function login(
  deps: AccountDeps,
  email: string,
  password: string,
  ip: string,
): Promise<{ token: string; principal: Principal }> {
  const { db } = deps;
  const now = deps.now();
  if (await isThrottled(db, email, ip, now)) throw new HttpError(429, 'too-many-attempts');

  const account = await findByEmail(db, email);
  if (!account) {
    await verifyAgainstDummy(password);
    await recordFailure(db, email, ip, now);
    throw new HttpError(401, 'invalid-credentials');
  }
  if (!(await verifyPassword(account.passwordHash, password))) {
    await recordFailure(db, email, ip, now);
    throw new HttpError(401, 'invalid-credentials');
  }
  // Status is revealed only after a correct password.
  if (!account.emailVerifiedAt) throw new HttpError(403, 'email-not-verified');
  if (account.suspendedAt) throw new HttpError(403, 'account-suspended');

  await clearFailures(db, email);
  const { token, id } = await createSession(db, account.id, now);
  return {
    token,
    principal: {
      sessionId: id,
      account: {
        id: account.id,
        email: account.email,
        role: account.role,
        language: account.uiLanguage,
      },
      actingAs: null,
    },
  };
}

export async function requestPasswordReset(deps: AccountDeps, email: string): Promise<void> {
  const account = await findByEmail(deps.db, email);
  if (account) await sendReset(deps, account, false);
}

export async function confirmPasswordReset(
  deps: AccountDeps,
  token: string,
  newPassword: string,
): Promise<void> {
  const now = deps.now();
  const passwordHash = await hashPassword(newPassword);
  await deps.db.transaction(async (tx) => {
    const accountId = await consumeToken(tx, token, 'reset_password', now);
    await tx
      .update(accounts)
      .set({
        passwordHash,
        updatedAt: now,
        // The reset mail proves the address belongs to the account.
        emailVerifiedAt: sql`coalesce(${accounts.emailVerifiedAt}, ${now.toISOString()}::timestamptz)`,
      })
      .where(eq(accounts.id, accountId));
    await tx
      .delete(accountTokens)
      .where(
        and(eq(accountTokens.accountId, accountId), eq(accountTokens.purpose, 'reset_password')),
      );
    await deleteSessionsOf(tx, accountId);
  });
}
