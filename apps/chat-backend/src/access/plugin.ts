import cookie from '@fastify/cookie';
import { type Db, type ResolvedSpace, resolveSpace, SPACE_COOKIE } from '@fetivi/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { HttpError } from '../http-error';
import { clearCookieOptions } from './cookies';

/** `public`: anyone; `space`: only a device holding a valid Space cookie. */
export type Access = 'public' | 'space';

declare module 'fastify' {
  interface FastifyContextConfig {
    access?: Access;
    /**
     * Skips the Origin check. Only for the RFC 8058 one-click unsubscribe POST, which mail
     * providers send without an Origin; that route only ever turns tips off and needs an HMAC token.
     */
    anyOrigin?: boolean;
  }
  interface FastifyRequest {
    space: ResolvedSpace | null;
  }
}

export interface AccessDeps {
  db: Db;
  appOrigin: string;
  now: () => Date;
}

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const isApi = (url: string) => url.startsWith('/api/');
const isWrite = (method: string) => !READ_METHODS.has(method);

/** The Space of a route whose access already required one. */
export function spaceOf(request: FastifyRequest): ResolvedSpace {
  if (!request.space) throw new HttpError(401, 'no-space');
  return request.space;
}

/** Registers the request lifecycle; must run before any route is registered. */
export function registerAccess(app: FastifyInstance, deps: AccessDeps): void {
  app.decorateRequest<ResolvedSpace | null>('space', null);
  app.register(cookie);

  app.addHook('onRoute', (route) => {
    if (isApi(route.url) && route.config?.access === undefined) {
      const methods = Array.isArray(route.method) ? route.method.join(',') : route.method;
      throw new Error(`Route ${methods} ${route.url} declares no access`);
    }
  });

  app.addHook('onRequest', async (request) => {
    request.space = null;
    if (isApi(request.url) && isWrite(request.method) && !request.routeOptions.config.anyOrigin) {
      if (request.headers.origin !== deps.appOrigin) throw new HttpError(403, 'bad-origin');
    }
  });

  // Cookies are parsed by @fastify/cookie's onRequest hook, which loads after this one,
  // so the space is resolved here, as the first preHandler step.
  app.addHook('preHandler', async (request, reply) => {
    if (!isApi(request.url)) return;
    const token = request.cookies[SPACE_COOKIE];
    if (token) {
      request.space = await resolveSpace(deps.db, token, deps.now());
      if (!request.space) reply.clearCookie(SPACE_COOKIE, clearCookieOptions);
    }
    if (request.routeOptions.config.access === 'space' && !request.space) {
      throw new HttpError(401, 'no-space');
    }
  });
}
