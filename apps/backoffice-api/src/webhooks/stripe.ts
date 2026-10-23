import {
  applyStripeEvent,
  type Db,
  type JobQueue,
  type PaymentGateway,
  parseStripeEvent,
} from '@fetivi/domain';
import type { FastifyInstance } from 'fastify';
import { HttpError } from '../http-error';

export interface StripeWebhookDeps {
  db: Db;
  queue: JobQueue;
  now: () => Date;
  /** The endpoint's `whsec_…` signing secret (Connect endpoint, or `stripe listen`). */
  secret: string;
  gateway: PaymentGateway;
}

const header = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * Stripe's events from connected accounts (`POST /webhooks/stripe`), the source of payment truth.
 * Outside `/api/`: no session and no Origin check, the signature is the credential. The event goes
 * to the machine, which processes each event id once; no Stripe call happens here. Every verified
 * event is acknowledged, also one that isn't ours, so Stripe stops retrying it. A database error
 * answers 500 and Stripe retries. The body is never logged.
 */
export async function stripeWebhookRoutes(app: FastifyInstance, deps: StripeWebhookDeps) {
  // The signature covers the exact bytes, so this scope keeps the body as a string.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) =>
    done(null, body),
  );

  app.post('/webhooks/stripe', async (request, reply) => {
    const rawBody = typeof request.body === 'string' ? request.body : '';
    let verified: unknown;
    try {
      verified = deps.gateway.constructEvent(
        rawBody,
        header(request.headers['stripe-signature']) ?? '',
        deps.secret,
      );
    } catch {
      throw new HttpError(401, 'bad-signature');
    }
    const event = parseStripeEvent(verified);
    const outcome = await applyStripeEvent(
      { db: deps.db, queue: deps.queue, now: deps.now },
      event,
    );
    const { id, type } = (verified ?? {}) as { id?: unknown; type?: unknown };
    request.log.info({ eventId: id, type, outcome }, 'stripe webhook');
    return reply.status(200).send({ ok: true });
  });
}
