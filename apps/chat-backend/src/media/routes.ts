import fastifyStatic from '@fastify/static';
import {
  blockMedia,
  type Db,
  loadGuestProjection,
  loadSituation,
  type MediaContentType,
  type MediaStore,
  mediaFileName,
} from '@fetivi/domain';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { spaceOf } from '../access/plugin';
import { HttpError } from '../http-error';

export interface MediaRouteDeps {
  db: Db;
  now: () => Date;
  media: MediaStore;
}

const MediaParams = z.object({ id: z.string() });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Block media files for the Guide and the property info card. A guest gets a file only when its id
 * is in the Space's guest projection right now: that one rule carries tenancy, publication and the
 * arrival release, and cannot drift from what the Guide shows. It reads the domain directly, like
 * saved places: this is a file download, not a tool, so V0 and V1 serve it the same way.
 */
export const mediaRoutes: FastifyPluginAsync<MediaRouteDeps> = async (app, deps) => {
  // `serve: false`: no directory is exposed, only sendFile below. It answers Range requests,
  // which iOS Safari needs to play video.
  await app.register(fastifyStatic, { root: deps.media.dir, serve: false, cacheControl: false });

  app.get('/api/media/:id', { config: { access: 'space' } }, async (request, reply) => {
    const { id } = MediaParams.parse(request.params);
    if (!UUID.test(id)) throw new HttpError(404, 'not-found');
    const now = deps.now();
    const ctx = await loadSituation(deps.db, spaceOf(request).space.id, now);
    if (!ctx) throw new HttpError(401, 'no-space');
    const projection = await loadGuestProjection(deps.db, {
      unitId: ctx.unitId,
      stayId: ctx.stayId,
      language: ctx.language,
      now,
    });
    if (!projection.blocks.some((b) => b.media.some((m) => m.id === id))) {
      throw new HttpError(404, 'not-found');
    }
    const [row] = await deps.db
      .select({ contentType: blockMedia.contentType })
      .from(blockMedia)
      .where(eq(blockMedia.id, id));
    if (!row) throw new HttpError(404, 'not-found');
    const contentType = row.contentType as MediaContentType;
    return reply
      .type(contentType)
      .header('cache-control', 'private, max-age=86400')
      .header('x-content-type-options', 'nosniff')
      .sendFile(mediaFileName(id, contentType));
  });
};
