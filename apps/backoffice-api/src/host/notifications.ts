import {
  countHostPushSubscriptions,
  type Db,
  deleteHostPushSubscription,
  getHostNotificationSettings,
  HOST_PUSH_HOSTS,
  type HostNotificationSettings,
  hostNotificationSettingsInput,
  isAllowedPushEndpoint,
  saveHostNotificationSettings,
  saveHostPushSubscription,
} from '@fetivi/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { principalOf } from '../auth/plugin';
import { HttpError } from '../http-error';
import { hostIdOf } from '../stays/routes';
import { hostPushSubscriptionBody, hostPushUnsubscribeBody } from './notification-schemas';

export interface HostNotificationDeps {
  db: Db;
  now: () => Date;
  /** The VAPID public key; null when push is not configured, so the page never offers alerts. */
  vapidPublicKey: string | null;
}

/**
 * The host's notification settings (PRD §6.6): Immediate or Digest at chosen times, and phone
 * alerts. Settings belong to the host (an acting admin may change them, audited by the auth
 * plugin); a phone belongs to the person holding it, so subscriptions use the signed-in account.
 */
export async function hostNotificationRoutes(
  app: FastifyInstance,
  deps: HostNotificationDeps,
): Promise<void> {
  const { db } = deps;
  const host = { config: { access: 'host' as const } };
  const accountOf = (request: FastifyRequest) => principalOf(request).account.id;

  const view = async (request: FastifyRequest, settings: HostNotificationSettings) => ({
    ...settings,
    push: {
      publicKey: deps.vapidPublicKey,
      devices: await countHostPushSubscriptions(db, accountOf(request)),
    },
  });

  app.get('/api/host/notification-settings', host, async (request) =>
    view(request, await getHostNotificationSettings(db, hostIdOf(request))),
  );

  app.put('/api/host/notification-settings', host, async (request) => {
    const input = hostNotificationSettingsInput.parse(request.body);
    return view(
      request,
      await saveHostNotificationSettings(db, hostIdOf(request), input, deps.now()),
    );
  });

  app.post('/api/host/push/subscription', host, async (request, reply) => {
    if (principalOf(request).actingAs !== null) throw new HttpError(403, 'forbidden');
    const { endpoint, keys } = hostPushSubscriptionBody.parse(request.body);
    if (!isAllowedPushEndpoint(endpoint, HOST_PUSH_HOSTS)) {
      throw new HttpError(422, 'push-endpoint');
    }
    await saveHostPushSubscription(db, accountOf(request), { endpoint, ...keys }, deps.now());
    return reply.status(204).send();
  });

  app.delete('/api/host/push/subscription', host, async (request, reply) => {
    const { endpoint } = hostPushUnsubscribeBody.parse(request.body);
    await deleteHostPushSubscription(db, accountOf(request), endpoint);
    return reply.status(204).send();
  });
}
