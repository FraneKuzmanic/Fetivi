import { randomUUID } from 'node:crypto';
import fastifyStatic from '@fastify/static';
import {
  type Db,
  type JobQueue,
  LIMITS,
  MEDIA_CONTENT_TYPES,
  MEDIA_TYPES,
  type MediaStore,
  mediaFileName,
  sniffMediaType,
} from '@fetivi/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { HttpError } from '../http-error';
import { blockOut, findOwnedBlock, mediaByBlock, mediaOut } from '../properties/store';
import { CaptionPatch, CaptionQuery, IdParams } from './schemas';
import { addMedia, deleteMedia, findOwnedMediaFile, updateCaption } from './store';

export interface MediaDeps {
  db: Db;
  queue: JobQueue;
  now: () => Date;
  media: MediaStore;
}

/** The host id comes only from request.auth, never from the client. */
function hostIdOf(request: FastifyRequest): string {
  const hostId = request.auth.hostId;
  if (!hostId) throw new HttpError(403, 'forbidden');
  return hostId;
}

/**
 * On the upload route, Fastify's own 413 and 415 mean a file too large or of a type we do not
 * take. Thrown on to the app's handler; on every other route they stay 400 invalid-input.
 */
const uploadErrors = (error: { statusCode?: number }) => {
  if (error.statusCode === 413) throw new HttpError(413, 'media-too-large');
  if (error.statusCode === 415) throw new HttpError(415, 'unsupported-media');
  throw error;
};

const declaredType = (request: FastifyRequest) =>
  (request.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();

/** Photos and short videos on Info blocks, uploaded as the raw request body, one per request. */
export async function mediaRoutes(app: FastifyInstance, deps: MediaDeps): Promise<void> {
  const { db, queue, media } = deps;
  const host = { config: { access: 'host' as const } };
  const idOf = (request: FastifyRequest) => IdParams.parse(request.params).id;
  const withMedia = async (block: Parameters<typeof blockOut>[0]) =>
    blockOut(block, (await mediaByBlock(db, [block.id])).get(block.id));

  // Only in this plugin's scope; the default body limit is 1 MB.
  app.addContentTypeParser(
    MEDIA_CONTENT_TYPES,
    { parseAs: 'buffer', bodyLimit: LIMITS.videoBytes },
    (_request, body, done) => done(null, body),
  );
  // For previews only: `serve: false` exposes no directory.
  await app.register(fastifyStatic, { root: media.dir, serve: false, cacheControl: false });

  app.post(
    '/api/host/blocks/:id/media',
    { ...host, bodyLimit: LIMITS.videoBytes, errorHandler: uploadErrors },
    async (request, reply) => {
      const hostId = hostIdOf(request);
      const block = await findOwnedBlock(db, hostId, idOf(request));
      const { caption } = CaptionQuery.parse(request.query);
      const body = request.body;
      if (!Buffer.isBuffer(body)) throw new HttpError(415, 'unsupported-media');
      // The bytes decide; the declared type must agree with them.
      const contentType = sniffMediaType(body);
      if (contentType === null || contentType !== declaredType(request)) {
        throw new HttpError(415, 'unsupported-media');
      }
      const kind = MEDIA_TYPES[contentType].kind;
      if (body.length > (kind === 'image' ? LIMITS.imageBytes : LIMITS.videoBytes)) {
        throw new HttpError(413, 'media-too-large');
      }

      const id = randomUUID();
      const fileName = mediaFileName(id, contentType);
      // Written before the transaction, never inside it. A crash between the two leaves an orphan
      // file for the retention sweep (ticket 45); a failed insert removes it here.
      await media.put(fileName, body);
      try {
        const result = await addMedia(db, queue, {
          id,
          blockId: block.id,
          hostId,
          contentType,
          bytes: body.length,
          caption,
          now: deps.now(),
        });
        return reply
          .status(201)
          .send({ media: mediaOut(result.media), block: await withMedia(result.block) });
      } catch (error) {
        await media.remove([fileName]);
        throw error;
      }
    },
  );

  app.patch('/api/host/media/:id', host, async (request) => {
    const { caption } = CaptionPatch.parse(request.body);
    const result = await updateCaption(db, queue, {
      mediaId: idOf(request),
      hostId: hostIdOf(request),
      caption,
      now: deps.now(),
    });
    return { media: mediaOut(result.media), block: await withMedia(result.block) };
  });

  app.delete('/api/host/media/:id', host, async (request, reply) => {
    const fileName = await deleteMedia(db, { mediaId: idOf(request), hostId: hostIdOf(request) });
    await media.remove([fileName]);
    return reply.status(204).send();
  });

  app.get('/api/host/media/:id', host, async (request, reply) => {
    const { fileName, contentType } = await findOwnedMediaFile(
      db,
      hostIdOf(request),
      idOf(request),
    );
    return reply
      .type(contentType)
      .header('cache-control', 'private, max-age=3600')
      .header('x-content-type-options', 'nosniff')
      .sendFile(fileName);
  });
}
