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
  | 'not-found'
  | 'email-taken'
  | 'not-approved';

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
