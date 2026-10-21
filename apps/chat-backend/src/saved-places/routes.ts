import { type Db, listSavedPlaceIds, savePlace, unsavePlace } from '@fetivi/domain';
import type { FastifyPluginAsync } from 'fastify';
import { spaceOf } from '../access/plugin';
import { HttpError } from '../http-error';
import { savedPlaceParams } from './schemas';

export interface SavedPlaceRouteDeps {
  db: Db;
  now: () => Date;
}

export const savedPlaceRoutes: FastifyPluginAsync<SavedPlaceRouteDeps> = async (
  app,
  { db, now },
) => {
  /** The places this Space saved from cards, newest first. */
  app.get('/api/saved-places', { config: { access: 'space' } }, async (request) => ({
    placeIds: await listSavedPlaceIds(db, spaceOf(request).space.id),
  }));

  /** The guest's Save tap. Only a place the guest could find; after the Stay only removals. */
  app.put('/api/saved-places/:placeId', { config: { access: 'space' } }, async (request) => {
    const resolved = spaceOf(request);
    const { placeId } = savedPlaceParams.parse(request.params);
    if (resolved.closed) throw new HttpError(409, 'space-closed');
    const spaceId = resolved.space.id;
    if ((await savePlace(db, spaceId, placeId, now())) === 'not-visible') {
      throw new HttpError(404, 'not-found');
    }
    return { placeIds: await listSavedPlaceIds(db, spaceId) };
  });

  app.delete('/api/saved-places/:placeId', { config: { access: 'space' } }, async (request) => {
    const spaceId = spaceOf(request).space.id;
    const { placeId } = savedPlaceParams.parse(request.params);
    await unsavePlace(db, spaceId, placeId);
    return { placeIds: await listSavedPlaceIds(db, spaceId) };
  });
};
