import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

export type ErrorCode =
  | 'invalid-input'
  | 'not-found'
  | 'bad-origin'
  | 'no-space'
  | 'wrong-pin'
  | 'too-many-attempts'
  | 'space-closed'
  | 'turn-in-progress'
  | 'nothing-to-answer'
  | 'orders-unavailable'
  | 'guide-unavailable'
  | 'saved-places-unavailable'
  | 'chat-unavailable'
  | 'turn-failed';

export class HttpError extends Error {
  override name = 'HttpError';
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    /** Merged into the body, e.g. `{ retryAfter }`. */
    readonly extra: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

/** Every error response is `{ error: <code> }`, plus the error's extra fields. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send({ error: error.code, ...error.extra });
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
