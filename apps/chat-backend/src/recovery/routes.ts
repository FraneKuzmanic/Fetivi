import {
  type Db,
  type JobQueue,
  requestRecoveryBySlug,
  requestRecoveryForSpace,
  restoreSpace,
  SPACE_COOKIE,
} from '@fetivi/domain';
import type { FastifyPluginAsync } from 'fastify';
import { spaceCookieOptions } from '../access/cookies';
import { spaceOf } from '../access/plugin';
import { spaceView } from '../access/routes';
import { slugParams } from '../access/schemas';
import { tokenBody } from '../email/schemas';
import { spaceRule } from '../http-error';
import { recoveryRequestBody } from './schemas';

export interface RecoveryRouteDeps {
  db: Db;
  now: () => Date;
  queue: JobQueue;
}

/**
 * Recovery links: asked for from the PIN screen or Settings, they move the Space to the device
 * that opens them (ADR 0009). Never logs the token or the email.
 */
export const recoveryRoutes: FastifyPluginAsync<RecoveryRouteDeps> = async (app, deps) => {
  const { db, now, queue } = deps;

  /** The same answer whether or not the email matches a Space here. */
  app.post(
    '/api/access/:slug/recovery',
    { config: { access: 'public' } },
    async (request, reply) => {
      const { slug } = slugParams.parse(request.params);
      const { email } = recoveryRequestBody.parse(request.body);
      await spaceRule(() => requestRecoveryBySlug(db, queue, { slug, email, now: now() }));
      return reply.status(202).send();
    },
  );

  /** From Settings, also during the read-only period. */
  app.post('/api/recovery', { config: { access: 'space' } }, async (request, reply) => {
    await spaceRule(() =>
      requestRecoveryForSpace(db, queue, { spaceId: spaceOf(request).space.id }),
    );
    return reply.status(202).send();
  });

  app.post('/api/recovery/restore', { config: { access: 'public' } }, async (request, reply) => {
    const { token } = tokenBody.parse(request.body);
    const at = now();
    const restored = await spaceRule(() => restoreSpace(db, { token, now: at }));
    reply.setCookie(
      SPACE_COOKIE,
      restored.cookieToken,
      spaceCookieOptions(restored.space.closedAt, at),
    );
    return reply.status(200).send(spaceView(restored));
  });
};
