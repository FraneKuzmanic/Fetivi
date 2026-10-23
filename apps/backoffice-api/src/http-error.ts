import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

export type ErrorCode =
  | 'invalid-input'
  | 'invalid-credentials'
  | 'email-not-verified'
  | 'account-suspended'
  | 'too-many-attempts'
  | 'invalid-token'
  | 'unauthenticated'
  | 'forbidden'
  | 'stop-acting-first'
  | 'bad-origin'
  | 'bad-signature'
  | 'not-found'
  | 'email-taken'
  | 'not-approved'
  | 'not-ready'
  | 'stale-revision'
  | 'translation-not-failed'
  | 'destination-not-empty'
  | 'provider-has-offers'
  | 'offer-has-orders'
  | 'offer-has-slots'
  | 'seats-taken'
  | 'unit-not-live'
  | 'stay-ended'
  | 'unsupported-media'
  | 'media-too-large'
  | 'too-many-media'
  | 'unsupported-manual'
  | 'manual-too-large'
  | 'manual-too-long'
  | 'manual-empty'
  | 'import-failed'
  | 'import-not-configured'
  | 'draft-resolved'
  | 'invalid-calendar-url'
  | 'calendar-exists'
  | 'too-many-calendars'
  | 'proposal-gone'
  | 'not-possibly-cancelled'
  | 'already-replied'
  | 'push-endpoint'
  | 'no-account'
  | 'payments-not-configured'
  | 'stripe-unavailable'
  | 'stripe-rejected'
  | 'not-cancellable'
  | 'not-refundable'
  | 'not-answerable';

export class HttpError extends Error {
  override name = 'HttpError';
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
  ) {
    super(code);
  }
}

/** Every error response is `{ error: <code> }`. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send({ error: error.code });
    }
    if (error instanceof ZodError) {
      return reply.status(400).send({ error: 'invalid-input' });
    }
    // Fastify's own client errors, such as a malformed JSON body.
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return reply.status(400).send({ error: 'invalid-input' });
    }
    request.log.error(error);
    return reply.status(500).send({ error: 'internal' });
  });
  app.setNotFoundHandler((_request, reply) => reply.status(404).send({ error: 'not-found' }));
}
