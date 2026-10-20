import {
  type Db,
  enterPin,
  findUnitBySlug,
  type ResolvedSpace,
  SPACE_COOKIE,
  SpaceRuleError,
  setSpaceLanguage,
} from '@fetivi/domain';
import type { FastifyPluginAsync } from 'fastify';
import { HttpError } from '../http-error';
import { ensureDeviceId, spaceCookieOptions } from './cookies';
import { spaceOf } from './plugin';
import { languageBody, pinBody, slugParams } from './schemas';

export interface AccessRouteDeps {
  db: Db;
  now: () => Date;
}

/** What the guest app learns about its space: no names, no unit or property details. */
const spaceView = (s: ResolvedSpace) => ({
  language: s.space.language,
  closedAt: s.space.closedAt.toISOString(),
  closed: s.closed,
  unitSlug: s.unitSlug,
});

const seconds = (ms: number) => Math.ceil(ms / 1000);

export const accessRoutes: FastifyPluginAsync<AccessRouteDeps> = async (app, { db, now }) => {
  /** Says only whether the link works. */
  app.get('/api/access/:slug', { config: { access: 'public' } }, async (request, reply) => {
    const { slug } = slugParams.parse(request.params);
    if (!(await findUnitBySlug(db, slug))) throw new HttpError(404, 'not-found');
    ensureDeviceId(request, reply);
    return reply.status(204).send();
  });

  app.post('/api/access/:slug/pin', { config: { access: 'public' } }, async (request, reply) => {
    const { slug } = slugParams.parse(request.params);
    const { pin, language } = pinBody.parse(request.body);
    const deviceId = ensureDeviceId(request, reply);
    const at = now();
    let result: Awaited<ReturnType<typeof enterPin>>;
    try {
      result = await enterPin(db, { slug, pin, language, deviceId, ip: request.ip, now: at });
    } catch (error) {
      if (error instanceof SpaceRuleError) throw new HttpError(404, 'not-found');
      throw error;
    }
    if (!result.ok) {
      const retryAfter = seconds(result.retryAfterMs);
      if (result.reason === 'throttled') {
        reply.header('Retry-After', String(retryAfter));
        throw new HttpError(429, 'too-many-attempts', { retryAfter });
      }
      throw new HttpError(401, 'wrong-pin', { retryAfter });
    }
    reply.setCookie(SPACE_COOKIE, result.token, spaceCookieOptions(result.space.closedAt, at));
    return reply.status(201).send({
      language: result.space.language,
      closedAt: result.space.closedAt.toISOString(),
      closed: false,
      unitSlug: slug,
    });
  });

  app.get('/api/space', { config: { access: 'space' } }, async (request) =>
    spaceView(spaceOf(request)),
  );

  app.patch('/api/space', { config: { access: 'space' } }, async (request) => {
    const resolved = spaceOf(request);
    const { language } = languageBody.parse(request.body);
    const space = await setSpaceLanguage(db, resolved.space.id, language, now());
    return spaceView({ ...resolved, space });
  });
};
