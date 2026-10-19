import Fastify from 'fastify';

export function buildApp(options: { logger?: boolean } = {}) {
  const app = Fastify({ logger: options.logger ?? true });
  app.get('/health', async () => ({ status: 'ok', service: 'backoffice-api' }));
  return app;
}
