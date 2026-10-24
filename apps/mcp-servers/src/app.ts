import {
  createBraveSearch,
  createWeatherSource,
  type Db,
  type GuestIdentity,
  type JobQueue,
  MCP_SERVERS,
  type McpServerName,
  type Scope,
  serverUrl,
  type WeatherSource,
  type WebSearch,
} from '@fetivi/domain';
import { traceRoutes } from '@fetivi/telemetry';
import { createMcpFastifyApp } from '@modelcontextprotocol/fastify';
import type { McpServer } from '@modelcontextprotocol/server';
import type { FastifyInstance } from 'fastify';
import type { JWTVerifyGetKey } from 'jose';
import { createGuestTokenVerifier } from './auth/verifier';
import type { Config } from './config';
import { egress } from './egress';
import { buildLocalServer } from './servers/local/server';
import { mountServer } from './servers/mount';
import { buildServicesServer } from './servers/services/server';
import { buildStayServer } from './servers/stay/server';
import { buildTripServer } from './servers/trip/server';

export interface AppDeps {
  config: Pick<
    Config,
    | 'HOST'
    | 'MCP_ALLOWED_HOSTS'
    | 'MCP_PUBLIC_URL'
    | 'GUEST_TOKEN_ISSUER'
    | 'REQUEST_STATE_SECRET'
    | 'WEATHER_USER_AGENT'
    | 'BRAVE_SEARCH_API_KEY'
  >;
  db: Db;
  /** Send-only: the Order machine enqueues its timers and notifications in its transaction. */
  queue: JobQueue;
  /** The chat backend's guest token keys (remote JWKS in production). */
  keys: JWTVerifyGetKey;
  /** For the projection's release gate and catalog dates; token checks always run on the real clock. */
  now?: () => Date;
  /** Built once here when not given, through the egress allowlist, so its cache is per process. */
  weather?: WeatherSource;
  /** Built here when not given: Brave through the egress allowlist; no key means unavailable. */
  webSearch?: WebSearch;
}

export function buildApp(deps: AppDeps) {
  const { config, db, keys, queue } = deps;
  const now = deps.now ?? (() => new Date());
  const app = createMcpFastifyApp({ host: config.HOST, allowedHosts: config.MCP_ALLOWED_HOSTS });
  traceRoutes(app);
  app.get('/health', async () => ({ status: 'ok', service: 'mcp-servers' }));
  mountServers(app, {
    db,
    keys,
    issuer: config.GUEST_TOKEN_ISSUER,
    publicBase: config.MCP_PUBLIC_URL,
    now,
    queue,
    requestStateSecret: config.REQUEST_STATE_SECRET,
    weather:
      deps.weather ??
      createWeatherSource({ fetch: egress.fetch, userAgent: config.WEATHER_USER_AGENT }),
    webSearch:
      deps.webSearch ??
      createBraveSearch({ fetch: egress.fetch, apiKey: config.BRAVE_SEARCH_API_KEY }),
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
    queue: JobQueue;
    /** HMAC key of the elicitation `requestState`, at least 32 bytes. */
    requestStateSecret: string;
    weather: WeatherSource;
    webSearch: WebSearch;
    overrides?: Partial<Record<McpServerName, (identity: GuestIdentity) => McpServer>>;
  },
) {
  const { db, now, queue, requestStateSecret, weather, webSearch } = opts;
  const deps = { db, now, queue, requestStateSecret, weather, webSearch };
  // `local` needs no scope at the gate: outside a destination the token has no catalog:read, yet
  // the server still answers with web_fallback_search alone; tools check per call.
  // `services` likewise: after checkout only list_my_orders is listed, and each tool checks its own.
  const servers: Record<
    McpServerName,
    { requiredScopes: Scope[]; factory: (identity: GuestIdentity) => McpServer }
  > = {
    stay: {
      requiredScopes: ['unit:read'],
      factory: (identity) => buildStayServer(identity, deps),
    },
    local: { requiredScopes: [], factory: (identity) => buildLocalServer(identity, deps) },
    services: {
      requiredScopes: [],
      factory: (identity) => buildServicesServer(identity, deps),
    },
    trip: {
      requiredScopes: ['about_me:read'],
      factory: (identity) => buildTripServer(identity, deps),
    },
  };
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
      ...(override ? { requiredScopes: [], factory: override } : servers[name]),
    });
  }
}
