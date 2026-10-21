import {
  type Db,
  type GuestIdentity,
  MCP_SERVERS,
  type McpServerName,
  serverUrl,
} from '@fetivi/domain';
import { createMcpFastifyApp } from '@modelcontextprotocol/fastify';
import type { McpServer } from '@modelcontextprotocol/server';
import type { FastifyInstance } from 'fastify';
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
  mountServers(app, {
    db,
    keys,
    issuer: config.GUEST_TOKEN_ISSUER,
    publicBase: config.MCP_PUBLIC_URL,
    now,
  });
  return app;
}

/** Mounts the four servers; `overrides` (tests only) swaps a server's factory, with no scope. */
export function mountServers(
  app: FastifyInstance,
  opts: {
    db: Db;
    keys: JWTVerifyGetKey;
    issuer: string;
    publicBase: string;
    now: () => Date;
    overrides?: Partial<Record<McpServerName, (identity: GuestIdentity) => McpServer>>;
  },
) {
  const { db, now } = opts;
  for (const name of MCP_SERVERS) {
    const verifier = createGuestTokenVerifier({
      keys: opts.keys,
      issuer: opts.issuer,
      audience: serverUrl(opts.publicBase, name),
    });
    const override = opts.overrides?.[name];
    mountServer(app, {
      name,
      publicBase: opts.publicBase,
      verifier,
      ...(override
        ? { requiredScopes: [], factory: override }
        : name === 'stay'
          ? {
              requiredScopes: ['unit:read'],
              factory: (identity) => buildStayServer(identity, { db, now }),
            }
          : { requiredScopes: [], factory: () => buildEmptyServer(name) }),
    });
  }
}
