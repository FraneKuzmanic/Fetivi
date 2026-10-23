import {
  CURATION_LIMITS,
  type Db,
  enqueueCurationItem,
  hostDestinations,
  listHostProviders,
  OfferRuleError,
  setProviderHidden,
} from '@fetivi/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError } from '../http-error';
import { line, optionalLine, optionalText } from '../properties/schemas';
import { hostIdOf } from '../stays/routes';

export interface HostProviderDeps {
  db: Db;
  now: () => Date;
}

const IdParams = z.object({ id: z.uuid() });
const HiddenBody = z.strictObject({ hidden: z.boolean() });
const SuggestionBody = z.strictObject({
  name: line(CURATION_LIMITS.suggestionName),
  contact: optionalLine(CURATION_LIMITS.suggestionContact).default(null),
  note: optionalText(CURATION_LIMITS.suggestionNote).default(null),
  destinationId: z.uuid().nullable().default(null),
});

/**
 * Host control over Providers (38, PRD §6.4): hide an approved Provider from the host's guests,
 * or suggest one to the admin, which goes on the curation queue (39).
 */
export async function hostProviderRoutes(
  app: FastifyInstance,
  deps: HostProviderDeps,
): Promise<void> {
  const { db, now } = deps;
  const host = { config: { access: 'host' as const } };

  app.get('/api/host/providers', host, async (request) => {
    const hostId = hostIdOf(request);
    const [providers, destinations] = await Promise.all([
      listHostProviders(db, hostId),
      hostDestinations(db, hostId),
    ]);
    return { providers, destinations };
  });

  app.put('/api/host/providers/:id/hidden', host, async (request) => {
    const { id } = IdParams.parse(request.params);
    const { hidden } = HiddenBody.parse(request.body);
    try {
      return await setProviderHidden(db, hostIdOf(request), id, hidden, now());
    } catch (error) {
      if (error instanceof OfferRuleError && error.code === 'not-found') {
        throw new HttpError(404, 'not-found');
      }
      throw error;
    }
  });

  app.post('/api/host/provider-suggestions', host, async (request, reply) => {
    const hostId = hostIdOf(request);
    const { destinationId, ...suggestion } = SuggestionBody.parse(request.body);
    // Only a destination the host's guests are in.
    if (
      destinationId &&
      !(await hostDestinations(db, hostId)).some((d) => d.id === destinationId)
    ) {
      throw new HttpError(400, 'invalid-input');
    }
    const item = await enqueueCurationItem(
      db,
      {
        kind: 'host_provider_suggestion',
        hostId,
        destinationId,
        payload: { kind: 'host_provider_suggestion', ...suggestion },
      },
      now(),
    );
    return reply.status(201).send(item);
  });
}
