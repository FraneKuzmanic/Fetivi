import { accounts, BACKOFFICE_LANGUAGES, GUEST_LANGUAGES } from '@fetivi/domain';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Principal } from './access';
import {
  type AccountDeps,
  confirmPasswordReset,
  Email,
  login,
  requestPasswordReset,
  resendVerification,
  signUp,
  verifyEmail,
} from './accounts';
import { Password } from './passwords';
import { principalOf } from './plugin';
import {
  clearCookieOptions,
  deleteSession,
  SESSION_COOKIE,
  sessionCookieOptions,
} from './sessions';

export interface Me {
  account: Principal['account'];
  actingAs: { id: string; email: string } | null;
}

export function toMe(principal: Principal): Me {
  return { account: principal.account, actingAs: principal.actingAs };
}

/** The language the signed-out page was showing; optional for older clients (ticket 53). */
const PageLanguage = z.enum(BACKOFFICE_LANGUAGES).optional();
const Credentials = z.object({
  email: Email,
  password: z.string().min(1).max(1024),
  language: PageLanguage,
});
const SignUpBody = z.object({ email: Email, password: Password, language: PageLanguage });
const EmailBody = z.object({ email: Email, language: PageLanguage });
const TokenBody = z.object({ token: z.string().min(1).max(256) });
const LanguageBody = z.strictObject({ language: z.enum(GUEST_LANGUAGES) });
const ResetBody = z.object({ token: z.string().min(1).max(256), password: Password });

export async function authRoutes(app: FastifyInstance, deps: AccountDeps): Promise<void> {
  const pub = { config: { access: 'public' as const } };
  const authed = { config: { access: 'authenticated' as const } };

  app.post('/api/auth/sign-up', pub, async (request, reply) => {
    const body = SignUpBody.parse(request.body);
    await signUp(deps, body.email, body.password, body.language);
    return reply.status(202).send({});
  });

  app.post('/api/auth/verify-email', pub, async (request) => {
    await verifyEmail(deps, TokenBody.parse(request.body).token);
    return {};
  });

  app.post('/api/auth/resend-verification', pub, async (request, reply) => {
    const body = EmailBody.parse(request.body);
    await resendVerification(deps, body.email, body.language);
    return reply.status(202).send({});
  });

  app.post('/api/auth/login', pub, async (request, reply) => {
    const body = Credentials.parse(request.body);
    const result = await login(deps, body.email, body.password, request.ip, body.language);
    // Rotate: a session the browser already carried is replaced, never reused.
    const previous = request.auth.principal;
    if (previous) await deleteSession(deps.db, previous.sessionId);
    reply.setCookie(SESSION_COOKIE, result.token, sessionCookieOptions);
    return toMe(result.principal);
  });

  app.post('/api/auth/logout', authed, async (request, reply) => {
    await deleteSession(deps.db, principalOf(request).sessionId);
    reply.clearCookie(SESSION_COOKIE, clearCookieOptions);
    return reply.status(204).send();
  });

  app.post('/api/auth/password-reset/request', pub, async (request, reply) => {
    const body = EmailBody.parse(request.body);
    await requestPasswordReset(deps, body.email, body.language);
    return reply.status(202).send({});
  });

  app.post('/api/auth/password-reset/confirm', pub, async (request, reply) => {
    const body = ResetBody.parse(request.body);
    await confirmPasswordReset(deps, body.token, body.password);
    return reply.status(204).send();
  });

  app.get('/api/auth/me', authed, async (request) => toMe(principalOf(request)));

  /**
   * The signed-in person's own language, marked as chosen so logins no longer follow the
   * browser; an acting admin changes theirs, not the host's.
   */
  app.put('/api/auth/me/language', authed, async (request) => {
    const principal = principalOf(request);
    const { language } = LanguageBody.parse(request.body);
    const now = deps.now();
    await deps.db
      .update(accounts)
      .set({ uiLanguage: language, uiLanguageChosenAt: now, updatedAt: now })
      .where(eq(accounts.id, principal.account.id));
    return toMe({
      ...principal,
      account: { ...principal.account, language, languageChosen: true },
    });
  });
}
