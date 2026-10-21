import type { Db, JobQueue, Mailer, MediaStore } from '@fetivi/domain';
import Fastify from 'fastify';
import { adminRoutes } from './admin/routes';
import { registerAuth } from './auth/plugin';
import { authRoutes } from './auth/routes';
import { catalogRoutes } from './catalog/routes';
import { hostRoutes } from './host/routes';
import { registerErrorHandler } from './http-error';
import { mediaRoutes } from './media/routes';
import { propertyRoutes } from './properties/routes';
import { providerLinkRoutes } from './provider-link/routes';
import { providerRoutes } from './providers/routes';
import { stayRoutes } from './stays/routes';

export interface AppDeps {
  db: Db;
  mailer: Mailer;
  /** Sends jobs and events inside the caller's transaction. */
  queue: JobQueue;
  webOrigin: string;
  /** Where unit QR codes point. */
  guestOrigin: string;
  now?: () => Date;
  logger?: boolean;
  /** Proxy addresses whose X-Forwarded-For is believed (e.g. 'loopback'); unset trusts none. */
  trustProxy?: string | undefined;
  /** Block media files. */
  media: MediaStore;
}

export function buildApp(deps: AppDeps) {
  const app = Fastify({ logger: deps.logger ?? true, trustProxy: deps.trustProxy ?? false });
  const now = deps.now ?? (() => new Date());
  const { db, mailer, queue, webOrigin, guestOrigin } = deps;

  registerErrorHandler(app);
  registerAuth(app, { db, webOrigin, now });

  app.get('/health', async () => ({ status: 'ok', service: 'backoffice-api' }));
  app.register(authRoutes, { db, mailer, webOrigin, now });
  app.register(hostRoutes, { db });
  app.register(propertyRoutes, { db, queue, now, guestOrigin, media: deps.media });
  app.register(mediaRoutes, { db, queue, now, media: deps.media });
  app.register(adminRoutes, { db, now });
  app.register(catalogRoutes, { db, queue, now });
  app.register(providerRoutes, { db, queue, now });
  app.register(providerLinkRoutes, { db, queue, now });
  app.register(stayRoutes, { db, now, guestOrigin });
  return app;
}
