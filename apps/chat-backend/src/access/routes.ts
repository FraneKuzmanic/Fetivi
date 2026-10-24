import {
  type Db,
  enterPin,
  findUnitBySlug,
  type ResolvedSpace,
  SPACE_COOKIE,
  SpaceRuleError,
  setEvaluationOptIn,
  setSpaceLanguage,
} from '@fetivi/domain';
import type { FastifyPluginAsync } from 'fastify';
import { HttpError } from '../http-error';
import { deviceIdOf, rememberDevice, spaceCookieOptions } from './cookies';
import { spaceOf } from './plugin';
import { pinBody, slugParams, spacePatchBody } from './schemas';

export interface AccessRouteDeps {
  db: Db;
  now: () => Date;
}

/** What the guest app learns about its space: no names, no unit or property details. */
export const spaceView = (s: ResolvedSpace) => ({
  language: s.space.language,
  closedAt: s.space.closedAt.toISOString(),
  closed: s.closed,
  unitSlug: s.unitSlug,
  keepForEvaluation: s.space.evaluationOptInAt !== null,
});

const seconds = (ms: number) => Math.ceil(ms / 1000);

export const accessRoutes: FastifyPluginAsync<AccessRouteDeps> = async (app, { db, now }) => {
  /** Says only whether the link works. */
  app.get('/api/access/:slug', { config: { access: 'public' } }, async (request, reply) => {
    const { slug } = slugParams.parse(request.params);
    if (!(await findUnitBySlug(db, slug))) throw new HttpError(404, 'not-found');
    rememberDevice(request, reply, deviceIdOf(request));
    return reply.status(204).send();
  });

  app.post('/api/access/:slug/pin', { config: { access: 'public' } }, async (request, reply) => {
    const { slug } = slugParams.parse(request.params);
    const { pin, language } = pinBody.parse(request.body);
    const deviceId = deviceIdOf(request);
    const at = now();
    let result: Awaited<ReturnType<typeof enterPin>>;
    try {
      result = await enterPin(db, { slug, pin, language, deviceId, ip: request.ip, now: at });
    } catch (error) {
      if (error instanceof SpaceRuleError) throw new HttpError(404, 'not-found');
      throw error;
    }
    // Only now: an unknown link answers 404 without handing out a device cookie.
    rememberDevice(request, reply, deviceId);
    if (!result.ok) {
      const retryAfter = seconds(result.retryAfterMs);
      if (result.reason === 'throttled') {
        reply.header('Retry-After', String(retryAfter));
        throw new HttpError(429, 'too-many-attempts', { retryAfter });
      }
      throw new HttpError(401, 'wrong-pin', { retryAfter });
    }
    reply.setCookie(SPACE_COOKIE, result.token, spaceCookieOptions(result.space.closedAt, at));
    return reply
      .status(201)
      .send(spaceView({ space: result.space, unitSlug: slug, closed: false }));
  });

  app.get('/api/space', { config: { access: 'space' } }, async (request) =>
    spaceView(spaceOf(request)),
  );

  /**
   * The language and the evaluation opt-in. Both stay changeable after checkout: consent can be
   * given or withdrawn until the Space is deleted.
   */
  app.patch('/api/space', { config: { access: 'space' } }, async (request) => {
    const resolved = spaceOf(request);
    const { language, keepForEvaluation } = spacePatchBody.parse(request.body);
    const at = now();
    let space = resolved.space;
    if (language !== undefined) space = await setSpaceLanguage(db, space.id, language, at);
    if (keepForEvaluation !== undefined) {
      space = await setEvaluationOptIn(db, space.id, keepForEvaluation, at);
    }
    return spaceView({ ...resolved, space });
  });
};
