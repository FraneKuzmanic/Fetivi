import { trace } from '@opentelemetry/api';
import type { FastifyInstance } from 'fastify';

/**
 * Names each HTTP server span after its route template and drops the raw path and query:
 * paths carry slugs and one-time tokens (`/api/access/:slug`, provider links) and queries can
 * carry guest text, so traces keep only the template.
 */
export function traceRoutes(app: FastifyInstance): void {
  app.addHook('onRequest', async (request) => {
    const span = trace.getActiveSpan();
    if (!span) return;
    const route = request.routeOptions.url ?? 'unmatched';
    span.updateName(`${request.method} ${route}`);
    span.setAttributes({ 'http.route': route, 'url.path': route });
    if (request.url.includes('?')) span.setAttribute('url.query', 'redacted');
  });
}
