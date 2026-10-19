import type { Db, Mailer } from '@fetivi/domain';
import Fastify from 'fastify';
import { adminRoutes } from './admin/routes';
import { registerAuth } from './auth/plugin';
import { authRoutes } from './auth/routes';
import { hostRoutes } from './host/routes';
import { registerErrorHandler } from './http-error';

export interface AppDeps {
  db: Db;
  mailer: Mailer;
  webOrigin: string;
  now?: () => Date;
  logger?: boolean;
}

export function buildApp(deps: AppDeps) {
  const app = Fastify({ logger: deps.logger ?? true });
  const now = deps.now ?? (() => new Date());
  const { db, mailer, webOrigin } = deps;

  registerErrorHandler(app);
  registerAuth(app, { db, webOrigin, now });

  app.get('/health', async () => ({ status: 'ok', service: 'backoffice-api' }));
  app.register(authRoutes, { db, mailer, webOrigin, now });
  app.register(hostRoutes, { db });
  app.register(adminRoutes, { db, now });
  return app;
}
