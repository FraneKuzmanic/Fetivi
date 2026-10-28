import {
  accounts,
  accountTokens,
  type BackofficeLanguage,
  backofficeLanguageOf,
  type Db,
  type Executor,
  HOST_COPY,
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

/**
 * The language of an account email: the person's choice, else the language the signed-out page
 * was showing, else the browser default stored at the last sign-up or login (ticket 53).
 */
function mailLanguage(account: Account, requestLanguage?: BackofficeLanguage): BackofficeLanguage {
  if (account.uiLanguageChosenAt) return backofficeLanguageOf(account.uiLanguage);
  return requestLanguage ?? backofficeLanguageOf(account.uiLanguage);
}

async function sendVerification(
  deps: AccountDeps,
  account: Account,
  language?: BackofficeLanguage,
): Promise<void> {
  const token = await issueToken(deps, account.id, 'verify_email');
  if (!token) return;
  const copy = HOST_COPY[mailLanguage(account, language)].account.verify;
  await deps.mailer.send({
    to: account.email,
    subject: copy.subject,
    text: `${copy.text}\n\n${deps.webOrigin}/verify-email?token=${token}`,
  });
}

async function sendReset(
  deps: AccountDeps,
  account: Account,
  alreadyRegistered: boolean,
  language?: BackofficeLanguage,
) {
  const token = await issueToken(deps, account.id, 'reset_password');
  if (!token) return;
  const { account: mails } = HOST_COPY[mailLanguage(account, language)];
  const copy = alreadyRegistered ? mails.alreadyRegistered : mails.reset;
  await deps.mailer.send({
    to: account.email,
    subject: copy.subject,
    text: `${copy.text}\n\n${deps.webOrigin}/reset-password?token=${token}`,
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

/**
 * Answers the same way whether or not the email is known. `language` is the signed-out page's
 * language; a new account starts in it, not yet marked as chosen.
 */
export async function signUp(
  deps: AccountDeps,
  email: string,
  password: string,
  language?: BackofficeLanguage,
): Promise<void> {
  const existing = await findByEmail(deps.db, email);
  if (!existing) {
    const [account] = await deps.db
      .insert(accounts)
      .values({
        email,
        passwordHash: await hashPassword(password),
        role: 'host',
        uiLanguage: language ?? 'en',
      })
      .onConflictDoNothing()
      .returning();
    // A concurrent sign-up for the same email won the race; it sends its own mail.
    if (account) await sendVerification(deps, account, language);
    return;
  }
  if (!existing.emailVerifiedAt) return sendVerification(deps, existing, language);
  return sendReset(deps, existing, true, language);
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

export async function resendVerification(
  deps: AccountDeps,
  email: string,
  language?: BackofficeLanguage,
): Promise<void> {
  const account = await findByEmail(deps.db, email);
  if (account && !account.emailVerifiedAt) await sendVerification(deps, account, language);
}

export async function login(
  deps: AccountDeps,
  email: string,
  password: string,
  ip: string,
  language?: BackofficeLanguage,
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
  // Until the person chooses, the account follows the language of the page they signed in on.
  let uiLanguage = account.uiLanguage;
  if (!account.uiLanguageChosenAt && language && language !== uiLanguage) {
    uiLanguage = language;
    await db
      .update(accounts)
      .set({ uiLanguage, updatedAt: now })
      .where(eq(accounts.id, account.id));
  }
  const { token, id } = await createSession(db, account.id, now);
  return {
    token,
    principal: {
      sessionId: id,
      account: {
        id: account.id,
        email: account.email,
        role: account.role,
        language: uiLanguage,
        languageChosen: account.uiLanguageChosenAt !== null,
      },
      actingAs: null,
    },
  };
}

export async function requestPasswordReset(
  deps: AccountDeps,
  email: string,
  language?: BackofficeLanguage,
): Promise<void> {
  const account = await findByEmail(deps.db, email);
  if (account) await sendReset(deps, account, false, language);
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
