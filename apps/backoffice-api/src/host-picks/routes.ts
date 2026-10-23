import {
  browseCatalogPlaces,
  createHostAddedPlace,
  createHostPick,
  type Db,
  deleteHostPlace,
  findOwnedHostPlace,
  HostPlaceRuleError,
  type JobQueue,
  listHostPlaces,
  retryHostPlaceTranslation,
  updateHostPlace,
} from '@fetivi/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { HttpError } from '../http-error';
import { findOwnedProperty } from '../properties/store';
import { hostIdOf } from '../stays/routes';
import { withTranslationErrors } from '../translation-errors';
import {
  CatalogPlacesQuery,
  HostAddedPlaceCreate,
  HostPickCreate,
  HostPlacePatch,
} from './schemas';

export interface HostPickDeps {
  db: Db;
  queue: JobQueue;
  now: () => Date;
}

const IdParams = z.object({ id: z.uuid() });

const RULE_STATUS: Record<HostPlaceRuleError['code'], number> = {
  'not-found': 404,
  'invalid-input': 400,
  'no-destination': 400,
  'outside-destination': 400,
  'already-picked': 409,
  'limit-reached': 409,
};

async function withHostPlaceErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof HostPlaceRuleError) {
      throw new HttpError(RULE_STATUS[error.code], error.code);
    }
    throw error;
  }
}

/**
 * Host picks, host-added places (40): owned through the property's host. Another host's id is
 * 404. No route here writes catalog_records: hosts never edit the catalog (AC 5). Act-as writes
 * are audited by the auth plugin.
 */
export async function hostPickRoutes(app: FastifyInstance, deps: HostPickDeps): Promise<void> {
  const { db, queue, now } = deps;
  const host = { config: { access: 'host' as const } };
  const idOf = (request: FastifyRequest) => IdParams.parse(request.params).id;
  const ownedProperty = async (request: FastifyRequest) =>
    (await findOwnedProperty(db, hostIdOf(request), idOf(request))).id;
  async function ownedPlace(request: FastifyRequest) {
    const place = await findOwnedHostPlace(db, hostIdOf(request), idOf(request));
    if (!place) throw new HttpError(404, 'not-found');
    return place;
  }

  app.get('/api/host/properties/:id/picks', host, async (request) =>
    listHostPlaces(db, await ownedProperty(request)),
  );

  app.get('/api/host/properties/:id/catalog-places', host, async (request) => {
    const propertyId = await ownedProperty(request);
    const { q } = CatalogPlacesQuery.parse(request.query);
    return { places: await withHostPlaceErrors(() => browseCatalogPlaces(db, propertyId, q)) };
  });

  app.post('/api/host/properties/:id/picks', host, async (request, reply) => {
    const propertyId = await ownedProperty(request);
    const input = HostPickCreate.parse(request.body);
    await withHostPlaceErrors(() => createHostPick(db, queue, propertyId, input, now()));
    return reply.status(201).send(await listHostPlaces(db, propertyId));
  });

  app.post('/api/host/properties/:id/added-places', host, async (request, reply) => {
    const propertyId = await ownedProperty(request);
    const input = HostAddedPlaceCreate.parse(request.body);
    await withHostPlaceErrors(() => createHostAddedPlace(db, queue, propertyId, input, now()));
    return reply.status(201).send(await listHostPlaces(db, propertyId));
  });

  app.patch('/api/host/host-places/:id', host, async (request) => {
    const place = await ownedPlace(request);
    const changes = HostPlacePatch.parse(request.body);
    await withHostPlaceErrors(() =>
      updateHostPlace(db, queue, place.propertyId, place.id, changes, now()),
    );
    return listHostPlaces(db, place.propertyId);
  });

  app.delete('/api/host/host-places/:id', host, async (request, reply) => {
    const place = await ownedPlace(request);
    await withHostPlaceErrors(() => deleteHostPlace(db, place.propertyId, place.id));
    return reply.status(204).send();
  });

  app.post('/api/host/host-places/:id/translations/retry', host, async (request) => {
    const place = await ownedPlace(request);
    await withTranslationErrors(() => retryHostPlaceTranslation({ db, queue, now }, place.id));
    return listHostPlaces(db, place.propertyId);
  });
}
