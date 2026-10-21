import type { Db } from '@fetivi/domain';
import type { Egress } from '@fetivi/egress';
import type { LanguageModel } from 'ai';
import Fastify from 'fastify';
import { registerAccess } from './access/plugin';
import { accessRoutes } from './access/routes';
import { chatRoutes } from './chat/routes';
import { registerErrorHandler } from './http-error';
import { createToolCatalog } from './mcp/tools';
import type { TokenConfig } from './tokens/mint';
import { tokenRoutes } from './tokens/routes';

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
  chat: {
    /** Null without an API key: the chat then answers 503. */
    model: LanguageModel | null;
    /** Outbound fetch to the MCP servers. */
    mcpFetch: Egress['fetch'];
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
  app.register(tokenRoutes, { key: deps.tokens.key });
  app.register(chatRoutes, {
    db,
    now,
    tokens: deps.tokens,
    model: deps.chat.model,
    mcpFetch: deps.chat.mcpFetch,
    catalog: createToolCatalog(),
    log: app.log,
  });
  return app;
}
