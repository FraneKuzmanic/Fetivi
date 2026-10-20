import { type Db, MCP_SERVERS, serverUrl } from '@fetivi/domain';
import { createMcpFastifyApp } from '@modelcontextprotocol/fastify';
import type { JWTVerifyGetKey } from 'jose';
import { createGuestTokenVerifier } from './auth/verifier';
import type { Config } from './config';
import { buildEmptyServer } from './servers/empty';
import { mountServer } from './servers/mount';
import { buildStayServer } from './servers/stay/server';

export interface AppDeps {
  config: Pick<Config, 'HOST' | 'MCP_ALLOWED_HOSTS' | 'MCP_PUBLIC_URL' | 'GUEST_TOKEN_ISSUER'>;
  db: Db;
  /** The chat backend's guest token keys (remote JWKS in production). */
  keys: JWTVerifyGetKey;
  /** For the projection's release gate only; token checks always run on the real clock. */
  now?: () => Date;
}

export function buildApp(deps: AppDeps) {
  const { config, db, keys } = deps;
  const now = deps.now ?? (() => new Date());
  const app = createMcpFastifyApp({ host: config.HOST, allowedHosts: config.MCP_ALLOWED_HOSTS });
  app.get('/health', async () => ({ status: 'ok', service: 'mcp-servers' }));

  for (const name of MCP_SERVERS) {
    const verifier = createGuestTokenVerifier({
      keys,
      issuer: config.GUEST_TOKEN_ISSUER,
      audience: serverUrl(config.MCP_PUBLIC_URL, name),
    });
    mountServer(app, {
      name,
      publicBase: config.MCP_PUBLIC_URL,
      verifier,
      ...(name === 'stay'
        ? {
            requiredScopes: ['unit:read'],
            factory: (identity) => buildStayServer(identity, { db, now }),
          }
        : { requiredScopes: [], factory: () => buildEmptyServer(name) }),
    });
  }
  return app;
}
