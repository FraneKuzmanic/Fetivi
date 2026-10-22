import { type Db, guestInboxState, markInboxSeen } from '@fetivi/domain';
import type { FastifyPluginAsync } from 'fastify';
import { spaceOf } from '../access/plugin';

export interface InboxRouteDeps {
  db: Db;
  now: () => Date;
}

/**
 * The guest's notification state: the Chat badge and each Host message's Sent or Read. These
 * are the guest's own states, not a model tool, so they read the domain directly. Also after
 * checkout, so a late reply still shows.
 */
export const inboxRoutes: FastifyPluginAsync<InboxRouteDeps> = async (app, deps) => {
  app.get('/api/inbox', { config: { access: 'space' } }, async (request) =>
    guestInboxState(deps.db, spaceOf(request).space.id),
  );

  /** The guest has seen the Chat: the badge counts from now. */
  app.post('/api/inbox/seen', { config: { access: 'space' } }, async (request, reply) => {
    await markInboxSeen(deps.db, spaceOf(request).space.id, deps.now());
    return reply.status(204).send();
  });
};
