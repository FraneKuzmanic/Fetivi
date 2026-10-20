import type { AddressInfo } from 'node:net';
import {
  type Db,
  loadSituation,
  type McpServerName,
  type SpaceContext,
  scopesFor,
  serverUrl,
} from '@fetivi/domain';
import { createTestDatabase, type TestDatabase } from '@fetivi/domain/testing';
import type { FastifyInstance } from 'fastify';
import {
  type CryptoKey,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWTVerifyGetKey,
  SignJWT,
} from 'jose';
import { buildApp } from './app';
import { loadConfig } from './config';

export const TEST_BASE = 'http://mcp.test';
export const TEST_ISSUER = 'http://chat.test';

export interface TestKeys {
  privateKey: CryptoKey;
  kid: string;
  keys: JWTVerifyGetKey;
}

/** An ephemeral ES256 pair with its local JWKS, standing in for the chat backend's. */
export async function createTestKeys(kid = 'test-key'): Promise<TestKeys> {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: 'ES256' };
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
    stay: o.ctx.stayId,
    unit: o.ctx.unitId,
    property: o.ctx.propertyId,
    destination: o.ctx.destinationId,
    lang: o.ctx.language,
    scope: o.scope ?? scopesFor(o.server, o.ctx).join(' '),
    ...o.claims,
  })
    .setProtectedHeader({ alg: 'ES256', typ: 'at+jwt', kid: keys.kid, ...o.header })
    .setIssuer(o.iss ?? TEST_ISSUER)
    .setAudience(o.aud ?? serverUrl(TEST_BASE, o.server))
    .setSubject(o.ctx.spaceId)
    .setIssuedAt(iat)
    .setExpirationTime(o.exp ?? iat + 300)
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
  /** Set when started with `listen: true`. */
  url: string;
  close: () => Promise<void>;
}

/** The MCP server process on its own test database, signed tokens from a test key. */
export async function createTestServer(options: { listen?: boolean } = {}): Promise<TestServer> {
  const testDb = await createTestDatabase();
  const keys = await createTestKeys();
  const config = loadConfig({ MCP_PUBLIC_URL: TEST_BASE, GUEST_TOKEN_ISSUER: TEST_ISSUER });
  const app = buildApp({ config, db: testDb.db, keys: keys.keys });
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
    url,
    close: async () => {
      await app.close();
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
