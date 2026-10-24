import { type Db, listHostSuggestions } from '@fetivi/domain';
import type { FastifyInstance } from 'fastify';
import { hostIdOf } from '../stays/routes';

export interface HostSuggestionDeps {
  db: Db;
  now: () => Date;
}

/**
 * The host's open content-gap Suggestions across their units (44 AC 3): Fetivi's sentence and a
 * wizard link, never transcripts or guest wording (AC 4). Reading resolves the ones whose field
 * the host has since filled.
 */
export async function hostSuggestionRoutes(
  app: FastifyInstance,
  deps: HostSuggestionDeps,
): Promise<void> {
  const { db, now } = deps;
  app.get('/api/host/suggestions', { config: { access: 'host' } }, async (request) => ({
    suggestions: await listHostSuggestions(db, hostIdOf(request), now()),
  }));
}
