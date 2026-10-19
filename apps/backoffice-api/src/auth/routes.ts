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
  account: { id: string; email: string; role: 'host' | 'admin' };
  actingAs: { id: string; email: string } | null;
}

export function toMe(principal: Principal): Me {
  return { account: principal.account, actingAs: principal.actingAs };
}

const Credentials = z.object({ email: Email, password: z.string().min(1).max(1024) });
const SignUpBody = z.object({ email: Email, password: Password });
const EmailBody = z.object({ email: Email });
const TokenBody = z.object({ token: z.string().min(1).max(256) });
const ResetBody = z.object({ token: z.string().min(1).max(256), password: Password });

export async function authRoutes(app: FastifyInstance, deps: AccountDeps): Promise<void> {
  const pub = { config: { access: 'public' as const } };
  const authed = { config: { access: 'authenticated' as const } };

  app.post('/api/auth/sign-up', pub, async (request, reply) => {
    const body = SignUpBody.parse(request.body);
    await signUp(deps, body.email, body.password);
    return reply.status(202).send({});
  });

  app.post('/api/auth/verify-email', pub, async (request) => {
    await verifyEmail(deps, TokenBody.parse(request.body).token);
    return {};
  });

  app.post('/api/auth/resend-verification', pub, async (request, reply) => {
    await resendVerification(deps, EmailBody.parse(request.body).email);
    return reply.status(202).send({});
  });

  app.post('/api/auth/login', pub, async (request, reply) => {
    const body = Credentials.parse(request.body);
    const result = await login(deps, body.email, body.password, request.ip);
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
    await requestPasswordReset(deps, EmailBody.parse(request.body).email);
    return reply.status(202).send({});
  });

  app.post('/api/auth/password-reset/confirm', pub, async (request, reply) => {
    const body = ResetBody.parse(request.body);
    await confirmPasswordReset(deps, body.token, body.password);
    return reply.status(204).send();
  });

  app.get('/api/auth/me', authed, async (request) => toMe(principalOf(request)));
}
