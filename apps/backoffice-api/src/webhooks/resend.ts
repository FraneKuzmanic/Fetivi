import { type Db, parseResendEvent, suppressEmail, verifyResendWebhook } from '@fetivi/domain';
import type { FastifyInstance } from 'fastify';
import { HttpError } from '../http-error';

export interface ResendWebhookDeps {
  db: Db;
  now: () => Date;
  /** The endpoint's `whsec_…` signing secret from the Resend dashboard. */
  secret: string;
}

const header = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * Resend's bounce and complaint events (`POST /webhooks/resend`). Outside `/api/`: no session and
 * no Origin check, the Svix signature is the credential. A permanent bounce or a complaint puts
 * each recipient on the suppression list; every other verified event is acknowledged and ignored.
 * The body is never logged.
 */
export async function resendWebhookRoutes(app: FastifyInstance, deps: ResendWebhookDeps) {
  // The signature covers the exact bytes, so this scope keeps the body as a string.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) =>
    done(null, body),
  );

  app.post('/webhooks/resend', async (request, reply) => {
    const rawBody = typeof request.body === 'string' ? request.body : '';
    const now = deps.now();
    const verified = verifyResendWebhook({
      secret: deps.secret,
      headers: {
        id: header(request.headers['svix-id']),
        timestamp: header(request.headers['svix-timestamp']),
        signature: header(request.headers['svix-signature']),
      },
      rawBody,
      now,
    });
    if (!verified) throw new HttpError(401, 'bad-signature');
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      throw new HttpError(400, 'invalid-input');
    }
    const event = parseResendEvent(json);
    const reason =
      event.type === 'complained'
        ? 'complained'
        : event.type === 'bounced' && event.permanent
          ? 'bounced'
          : null;
    if (reason) {
      for (const email of event.recipients) await suppressEmail(deps.db, email, reason, now);
    }
    return reply.status(200).send({ ok: true });
  });
}
