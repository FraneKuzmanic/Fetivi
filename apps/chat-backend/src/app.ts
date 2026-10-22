import type { Db, JobQueue, MediaStore } from '@fetivi/domain';
import type { Egress } from '@fetivi/egress';
import type { LanguageModel } from 'ai';
import Fastify from 'fastify';
import { aboutMeRoutes } from './about-me/routes';
import { registerAccess } from './access/plugin';
import { accessRoutes } from './access/routes';
import { chatRoutes } from './chat/routes';
import { emailRoutes } from './email/routes';
import { guideRoutes } from './guide/routes';
import { registerErrorHandler } from './http-error';
import { inboxRoutes } from './inbox/routes';
import { createToolCatalog } from './mcp/tools';
import { mediaRoutes } from './media/routes';
import { orderRoutes } from './orders/routes';
import { planRoutes } from './plan/routes';
import { pushRoutes } from './push/routes';
import { recoveryRoutes } from './recovery/routes';
import { savedPlaceRoutes } from './saved-places/routes';
import type { TokenConfig } from './tokens/mint';
import { tokenRoutes } from './tokens/routes';
import { mcpBinding, type ToolBinding } from './tools/registry';

export interface AppDeps {
  db: Db;
  /** The guest SPA's origin; API writes must carry it. */
  appOrigin: string;
  now?: () => Date;
  logger?: boolean;
  /** Proxy addresses whose X-Forwarded-For is believed (e.g. 'loopback'); unset trusts none. */
  trustProxy?: string | undefined;
  /** Guest token signing for the MCP servers; its public key is served as the JWKS. */
  tokens: TokenConfig;
  /** Sends jobs (the email and recovery mails) for the jobs process to work. */
  queue: JobQueue;
  /** Block media files, served to guests through /api/media. */
  media: MediaStore;
  /** Web push: the VAPID public key, or null (unset) when push is not configured. */
  push?: { publicKey: string | null };
  chat: {
    /** Null without an API key: the chat then answers 503. */
    model: LanguageModel | null;
    /** Outbound fetch to the MCP servers. */
    mcpFetch: Egress['fetch'];
    /** How the guest tools run; MCP when unset. V0 passes the in-process binding. */
    tools?: ToolBinding;
  };
}

export function buildApp(deps: AppDeps) {
  const app = Fastify({ logger: deps.logger ?? true, trustProxy: deps.trustProxy ?? false });
  const now = deps.now ?? (() => new Date());
  const { db, appOrigin } = deps;

  registerErrorHandler(app);
  registerAccess(app, { db, appOrigin, now });

  app.get('/health', async () => ({ status: 'ok', service: 'chat-backend' }));
  app.register(accessRoutes, { db, now });
  app.register(aboutMeRoutes, { db, now });
  app.register(savedPlaceRoutes, { db, now });
  app.register(tokenRoutes, { key: deps.tokens.key });
  // One binding, and so one tool-definition cache, per app.
  const tools =
    deps.chat.tools ??
    mcpBinding({ tokens: deps.tokens, mcpFetch: deps.chat.mcpFetch, catalog: createToolCatalog() });
  app.register(orderRoutes, { db, now, tools });
  app.register(planRoutes, { db, now, tools });
  app.register(inboxRoutes, { db, now });
  app.register(emailRoutes, { db, now, queue: deps.queue });
  app.register(recoveryRoutes, { db, now, queue: deps.queue });
  app.register(pushRoutes, { db, now, publicKey: deps.push?.publicKey ?? null });
  app.register(guideRoutes, { db, now, tools });
  app.register(mediaRoutes, { db, now, media: deps.media });
  app.register(chatRoutes, { db, now, model: deps.chat.model, tools, log: app.log });
  return app;
}
