import {
  type Db,
  isAllowedPushEndpoint,
  pushState,
  recordPushOffer,
  savePushSubscription,
} from '@fetivi/domain';
import type { FastifyPluginAsync } from 'fastify';
import { spaceOf } from '../access/plugin';
import { HttpError } from '../http-error';
import { pushSubscriptionBody } from './schemas';

export interface PushRouteDeps {
  db: Db;
  now: () => Date;
  /** The VAPID public key; null when push is not configured, so the guest app never offers it. */
  publicKey: string | null;
}

/**
 * The guest's one-time "Alert me on this phone" offer. Any outcome of the offer is recorded, so it
 * is never shown again. Not a model tool: the guest's own tap drives it.
 */
export const pushRoutes: FastifyPluginAsync<PushRouteDeps> = async (app, deps) => {
  app.get('/api/push', { config: { access: 'space' } }, async (request) => ({
    publicKey: deps.publicKey,
    ...(await pushState(deps.db, spaceOf(request).space.id)),
  }));

  /** Declined or dismissed: the offer is spent. */
  app.post('/api/push/offer', { config: { access: 'space' } }, async (request, reply) => {
    const resolved = spaceOf(request);
    if (resolved.closed) throw new HttpError(409, 'space-closed');
    await recordPushOffer(deps.db, resolved.space.id, deps.now());
    return reply.status(204).send();
  });

  /** Allowed: the browser's subscription is stored, and the offer is spent. */
  app.post('/api/push/subscription', { config: { access: 'space' } }, async (request, reply) => {
    const resolved = spaceOf(request);
    if (resolved.closed) throw new HttpError(409, 'space-closed');
    const { endpoint, keys } = pushSubscriptionBody.parse(request.body);
    if (!isAllowedPushEndpoint(endpoint)) throw new HttpError(422, 'push-endpoint');
    const now = deps.now();
    const spaceId = resolved.space.id;
    await deps.db.transaction(async (tx) => {
      await savePushSubscription(tx, spaceId, { endpoint, ...keys }, now);
      await recordPushOffer(tx, spaceId, now);
    });
    return reply.status(204).send();
  });
};
