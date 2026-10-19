import cookie from '@fastify/cookie';
import { actAsAudit, type Db } from '@fetivi/domain';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { HttpError } from '../http-error';
import { type Access, decideAccess, type Principal } from './access';
import { clearCookieOptions, resolveSession, SESSION_COOKIE } from './sessions';

declare module 'fastify' {
  interface FastifyContextConfig {
    access?: Access;
  }
  interface FastifyRequest {
    auth: { principal: Principal | null; hostId: string | null };
  }
}

export interface AuthDeps {
  db: Db;
  webOrigin: string;
  now: () => Date;
}

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const isApi = (url: string) => url.startsWith('/api/');
const isWrite = (method: string) => !READ_METHODS.has(method);

/** The principal of a route whose access already required one. */
export function principalOf(request: FastifyRequest): Principal {
  const { principal } = request.auth;
  if (!principal) throw new HttpError(401, 'unauthenticated');
  return principal;
}

/** Registers the request lifecycle; must run before any route is registered. */
export function registerAuth(app: FastifyInstance, deps: AuthDeps): void {
  const auditIds = new WeakMap<FastifyRequest, number>();

  // Fastify 5 needs null for reference types; onRequest assigns a fresh object per request.
  app.decorateRequest<FastifyRequest['auth'] | null>('auth', null);
  app.register(cookie);

  app.addHook('onRoute', (route) => {
    if (isApi(route.url) && route.config?.access === undefined) {
      const methods = Array.isArray(route.method) ? route.method.join(',') : route.method;
      throw new Error(`Route ${methods} ${route.url} declares no access`);
    }
  });

  app.addHook('onRequest', async (request) => {
    request.auth = { principal: null, hostId: null };
    if (isApi(request.url) && isWrite(request.method)) {
      if (request.headers.origin !== deps.webOrigin) throw new HttpError(403, 'bad-origin');
    }
  });

  // Cookies are parsed by @fastify/cookie's onRequest hook, which loads after this one,
  // so the session is resolved here, as the first preHandler step.
  app.addHook('preHandler', async (request, reply) => {
    if (!isApi(request.url)) return;

    const token = request.cookies[SESSION_COOKIE];
    if (token) {
      request.auth.principal = await resolveSession(deps.db, token, deps.now());
      if (!request.auth.principal) reply.clearCookie(SESSION_COOKIE, clearCookieOptions);
    }

    const decision = decideAccess(
      request.routeOptions.config.access ?? 'public',
      request.auth.principal,
    );
    if (!decision.ok) throw new HttpError(decision.status, decision.code);
    request.auth.hostId = decision.hostId;

    // Logged before the handler runs: if the insert fails, the write never happens.
    const { principal } = request.auth;
    if (principal?.actingAs && isWrite(request.method)) {
      const [row] = await deps.db
        .insert(actAsAudit)
        .values({
          adminId: principal.account.id,
          hostId: principal.actingAs.id,
          hostEmail: principal.actingAs.email,
          method: request.method,
          route: request.routeOptions.url ?? request.url.split('?')[0] ?? '',
          createdAt: deps.now(),
        })
        .returning({ id: actAsAudit.id });
      if (row) auditIds.set(request, row.id);
    }
  });

  app.addHook('onResponse', async (request, reply) => {
    const id = auditIds.get(request);
    if (id === undefined) return;
    try {
      await deps.db
        .update(actAsAudit)
        .set({ statusCode: reply.statusCode })
        .where(eq(actAsAudit.id, id));
    } catch (error) {
      request.log.error({ err: error, auditId: id }, 'could not record act-as status code');
    }
  });
}
