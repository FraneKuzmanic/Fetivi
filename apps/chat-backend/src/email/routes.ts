import {
  type Db,
  type JobQueue,
  optInSpaceEmail,
  resendVerification,
  SpaceRuleError,
  setTipsOptIn,
  spaceEmailState,
  verifySpaceEmail,
} from '@fetivi/domain';
import type { FastifyPluginAsync } from 'fastify';
import { spaceOf } from '../access/plugin';
import { HttpError } from '../http-error';
import { emailBody, tipsBody, tokenBody } from './schemas';

export interface EmailRouteDeps {
  db: Db;
  now: () => Date;
  queue: JobQueue;
}

/** Maps the Space rules the email and recovery routes share to HTTP answers. */
export async function spaceRule<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof SpaceRuleError)) throw error;
    if (error.code === 'invalid-token') throw new HttpError(400, 'invalid-token');
    if (error.code === 'no-email') throw new HttpError(409, 'no-email');
    throw new HttpError(404, 'not-found');
  }
}

/**
 * The Space's one email opt-in (the "Email me updates" offer; the Order card opts in through the
 * services server), the separate daily-tip opt-in, and the verification link.
 */
export const emailRoutes: FastifyPluginAsync<EmailRouteDeps> = async (app, deps) => {
  const { db, now, queue } = deps;

  app.get('/api/email', { config: { access: 'space' } }, async (request) =>
    spaceEmailState(db, spaceOf(request).space.id),
  );

  app.post('/api/email', { config: { access: 'space' } }, async (request) => {
    const resolved = spaceOf(request);
    if (resolved.closed) throw new HttpError(409, 'space-closed');
    const { email, tips } = emailBody.parse(request.body);
    const spaceId = resolved.space.id;
    await db.transaction((tx) => optInSpaceEmail(tx, queue, { spaceId, email, tips, now: now() }));
    return spaceEmailState(db, spaceId);
  });

  app.patch('/api/email', { config: { access: 'space' } }, async (request) => {
    const resolved = spaceOf(request);
    if (resolved.closed) throw new HttpError(409, 'space-closed');
    const { tips } = tipsBody.parse(request.body);
    await spaceRule(() => setTipsOptIn(db, resolved.space.id, tips, now()));
    return spaceEmailState(db, resolved.space.id);
  });

  /** Another confirmation link; nothing is sent once confirmed. */
  app.post('/api/email/verification', { config: { access: 'space' } }, async (request, reply) => {
    await spaceRule(() => resendVerification(db, queue, spaceOf(request).space.id));
    return reply.status(202).send();
  });

  /** Public: the link may be opened on a device without the Space. */
  app.post('/api/email/verify', { config: { access: 'public' } }, async (request, reply) => {
    const { token } = tokenBody.parse(request.body);
    await spaceRule(() => verifySpaceEmail(db, token, now()));
    return reply.status(204).send();
  });
};
