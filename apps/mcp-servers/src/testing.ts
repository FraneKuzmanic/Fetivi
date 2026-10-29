import type { AddressInfo } from 'node:net';
import {
  createJobQueue,
  type Db,
  type Embedder,
  ensureQueues,
  GUEST_LANGUAGES,
  GUEST_TOKEN_ALG,
  GUEST_TOKEN_TTL_SECONDS,
  GUEST_TOKEN_TYPE,
  type GuestIdentity,
  guestClaimsFor,
  loadSituation,
  type McpServerName,
  type SpaceContext,
  serverUrl,
  type WeatherSource,
  type WebSearch,
} from '@fetivi/domain';
import {
  createTestDatabase,
  noopQueue,
  type TestDatabase,
  unavailableEmbedder,
  unavailableWeatherSource,
  unavailableWebSearch,
} from '@fetivi/domain/testing';
import { createMcpFastifyApp } from '@modelcontextprotocol/fastify';
import { McpServer } from '@modelcontextprotocol/server';
import { trace } from '@opentelemetry/api';
import type { FastifyInstance } from 'fastify';
import {
  type CryptoKey,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWTVerifyGetKey,
  SignJWT,
} from 'jose';
import { PgBoss } from 'pg-boss';
import { z } from 'zod';
import { buildApp, mountServers } from './app';
import { loadConfig } from './config';
import { registerGuestTool } from './servers/tool';
import { SERVER_VERSION } from './servers/version';

export const TEST_BASE = 'http://mcp.test';
export const TEST_ISSUER = 'http://chat.test';
/** The fixed test HMAC key of the elicitation `requestState`. */
export const TEST_REQUEST_STATE_SECRET = 'test-request-state-secret-0123456789abcdef';

export interface TestKeys {
  privateKey: CryptoKey;
  kid: string;
  keys: JWTVerifyGetKey;
}

/** An ephemeral ES256 pair with its local JWKS, standing in for the chat backend's. */
export async function createTestKeys(kid = 'test-key'): Promise<TestKeys> {
  const { privateKey, publicKey } = await generateKeyPair(GUEST_TOKEN_ALG, { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: GUEST_TOKEN_ALG };
  return { privateKey, kid, keys: createLocalJWKSet({ keys: [jwk] }) };
}

export interface SignOptions {
  server: McpServerName;
  ctx: SpaceContext;
  /** Defaults to the real now: the SDK and jose check expiry on the real clock. */
  iat?: number;
  exp?: number;
  aud?: string;
  iss?: string;
  scope?: string;
  /** Claims replaced or added as-is (e.g. a forged `unit`). */
  claims?: Record<string, unknown>;
  header?: Record<string, unknown>;
  key?: CryptoKey;
}

/** A guest token as the chat backend mints it, with any part overridable. */
export async function signToken(keys: TestKeys, o: SignOptions): Promise<string> {
  const iat = o.iat ?? Math.floor(Date.now() / 1000);
  return new SignJWT({
    ...guestClaimsFor(o.server, o.ctx),
    ...(o.scope === undefined ? {} : { scope: o.scope }),
    ...o.claims,
  })
    .setProtectedHeader({ alg: GUEST_TOKEN_ALG, typ: GUEST_TOKEN_TYPE, kid: keys.kid, ...o.header })
    .setIssuer(o.iss ?? TEST_ISSUER)
    .setAudience(o.aud ?? serverUrl(TEST_BASE, o.server))
    .setSubject(o.ctx.spaceId)
    .setIssuedAt(iat)
    .setExpirationTime(o.exp ?? iat + GUEST_TOKEN_TTL_SECONDS)
    .sign(o.key ?? keys.privateKey);
}

/** The situation of a seeded space right now. */
export async function contextOf(db: Db, spaceId: string): Promise<SpaceContext> {
  const ctx = await loadSituation(db, spaceId, new Date());
  if (!ctx) throw new Error('no space');
  return ctx;
}

export interface TestServer {
  app: FastifyInstance;
  db: Db;
  testDb: TestDatabase;
  keys: TestKeys;
  /** Send-only, on the test database: jobs the Order machine enqueues land in `pgboss.job`. */
  boss: PgBoss;
  /** Set when started with `listen: true`. */
  url: string;
  close: () => Promise<void>;
}

/** The MCP server process on its own test database, signed tokens from a test key. */
export async function createTestServer(
  options: {
    listen?: boolean;
    now?: () => Date;
    /** Default: every weather upstream down, so no test reaches the network. */
    weather?: WeatherSource;
    /** Default: web search down, so no test reaches Brave. */
    webSearch?: WebSearch;
    /** Default: no embeddings, so no test reaches Voyage and search matches words. */
    embedder?: Embedder;
  } = {},
): Promise<TestServer> {
  const testDb = await createTestDatabase();
  const keys = await createTestKeys();
  const boss = new PgBoss({ connectionString: testDb.url, supervise: false, schedule: false });
  boss.on('error', console.error);
  await boss.start();
  await ensureQueues(boss);
  const config = loadConfig({
    MCP_PUBLIC_URL: TEST_BASE,
    GUEST_TOKEN_ISSUER: TEST_ISSUER,
    REQUEST_STATE_SECRET: TEST_REQUEST_STATE_SECRET,
  });
  const app = buildApp({
    config,
    db: testDb.db,
    keys: keys.keys,
    queue: createJobQueue(boss),
    now: options.now,
    weather: options.weather ?? unavailableWeatherSource(),
    webSearch: options.webSearch ?? unavailableWebSearch(),
    embedder: options.embedder ?? unavailableEmbedder(),
  });
  let url = '';
  if (options.listen) {
    await app.listen({ host: '127.0.0.1', port: 0 });
    url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  } else {
    await app.ready();
  }
  return {
    app,
    db: testDb.db,
    testDb,
    keys,
    boss,
    url,
    close: async () => {
      await app.close();
      await boss.stop({ graceful: false, timeout: 1000 });
      await testDb.drop();
    },
  };
}

/** A JSON-RPC POST through `app.inject`. */
export function mcpPost(app: FastifyInstance, path: string, token: string | null, body: unknown) {
  return app.inject({
    method: 'POST',
    url: path,
    headers: {
      host: '127.0.0.1',
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    payload: JSON.stringify(body),
  });
}

type MountOptions = Parameters<typeof mountServers>[1];

/**
 * The four servers as buildApp mounts them, for other apps' tests; `overrides` swaps a server.
 * Jobs are dropped, the requestState key is fixed and every weather upstream and web search is
 * down unless given.
 */
export function buildMcpTestApp(
  opts: Omit<MountOptions, 'queue' | 'requestStateSecret' | 'weather' | 'webSearch' | 'embedder'> &
    Partial<
      Pick<MountOptions, 'queue' | 'requestStateSecret' | 'weather' | 'webSearch' | 'embedder'>
    >,
): FastifyInstance {
  const app = createMcpFastifyApp({ host: '127.0.0.1', allowedHosts: ['127.0.0.1', 'localhost'] });
  mountServers(app, {
    queue: noopQueue,
    requestStateSecret: TEST_REQUEST_STATE_SECRET,
    weather: unavailableWeatherSource(),
    webSearch: unavailableWebSearch(),
    embedder: unavailableEmbedder(),
    ...opts,
  });
  return app;
}

/**
 * A test-only server with one guest tool, `probe_situation`, that echoes the caller's language
 * and scopes: proves a model tool call reaches an MCP server with this turn's token.
 */
export function buildProbeServer(identity: GuestIdentity): McpServer {
  const server = new McpServer(
    { name: 'fetivi-probe', version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );
  registerGuestTool(
    server,
    identity,
    'probe_situation',
    {
      title: 'Test probe',
      description: 'Test probe',
      scope: 'catalog:read',
      inputSchema: z.object({ topic: z.string().max(40) }),
      outputSchema: z.object({
        topic: z.string(),
        language: z.enum(GUEST_LANGUAGES),
        scopes: z.array(z.string()),
      }),
      annotations: { readOnlyHint: true },
    },
    // A span stands in for the queries a real tool makes, so tests can see work nested in the
    // server's span.
    async ({ topic }) =>
      trace.getTracer('fetivi-probe').startActiveSpan('probe work', async (span) => {
        try {
          return { topic, language: identity.language, scopes: identity.scopes };
        } finally {
          span.end();
        }
      }),
  );
  return server;
}
