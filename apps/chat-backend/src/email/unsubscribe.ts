import { type Db, unsubscribeTips, verifyTipsUnsubscribe } from '@fetivi/domain';
import type { FastifyPluginAsync } from 'fastify';
import { HttpError } from '../http-error';
import { unsubscribeLink } from './schemas';

export interface TipsUnsubscribeDeps {
  db: Db;
  now: () => Date;
  guestLinkSecret: string;
}

/**
 * One-click daily-tip unsubscribe. Mail providers POST the `List-Unsubscribe` URL (RFC 8058) as
 * form data with no cookies and no Origin, so the URL carries the space and its HMAC token; the
 * guest page `/unsubscribe-tips` posts the same fields as JSON. Only ever turns tips off.
 */
export const tipsUnsubscribeRoutes: FastifyPluginAsync<TipsUnsubscribeDeps> = async (app, deps) => {
  // Scoped to this plugin: the body (`List-Unsubscribe=One-Click`) carries nothing we need.
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_request, _body, done) => done(null, null),
  );

  app.post(
    '/api/email/tips/unsubscribe',
    { config: { access: 'public', anyOrigin: true } },
    async (request, reply) => {
      const body = request.body && typeof request.body === 'object' ? request.body : {};
      const link = unsubscribeLink.safeParse({ ...(request.query as object), ...body });
      if (
        !link.success ||
        !verifyTipsUnsubscribe(deps.guestLinkSecret, link.data.space, link.data.token)
      ) {
        throw new HttpError(400, 'invalid-link');
      }
      await unsubscribeTips(deps.db, link.data.space, deps.now());
      return reply.status(204).send();
    },
  );
};
