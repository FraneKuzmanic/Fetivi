import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {
  accounts,
  createLocalMediaStore,
  type Db,
  type JobQueue,
  properties,
  type ResolvedSpace,
  registerStay,
  resolveSpace,
  SPACE_COOKIE,
  type ToolTransport,
  units,
  type WeatherSource,
} from '@fetivi/domain';
import {
  createTestDatabase,
  noopQueue,
  type SeededGuestUnit,
  type TestDatabase,
  unavailableEmbedder,
  unavailableWeatherSource,
  unavailableWebSearch,
} from '@fetivi/domain/testing';
import { createEgress, type Egress } from '@fetivi/egress';
import {
  buildMcpTestApp,
  buildProbeServer,
  TEST_REQUEST_STATE_SECRET,
} from '@fetivi/mcp-servers/testing';
import type { LanguageModel, UIMessageChunk } from 'ai';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { createLocalJWKSet } from 'jose';
import { type AppDeps, buildApp } from './app';
import type { Ferryhopper } from './mcp/external/ferryhopper';
import { loadSigningKey } from './tokens/keys';
import type { TokenConfig } from './tokens/mint';
import { inProcessBinding } from './tools/inprocess';

export const APP_TEST_ORIGIN = 'http://app.test';
export const START = new Date('2026-10-19T10:00:00Z');
export const TEST_ISSUER = 'http://chat.test';
export const TEST_MCP_BASE = 'http://mcp.test';
export const TEST_GUEST_LINK_SECRET = 'chat-test-guest-link-secret-long-enough';

/** Chat deps for apps whose tests never chat: no model, and no MCP fetch. */
export const NO_CHAT: AppDeps['chat'] = {
  model: null,
  mcpFetch: async () => {
    throw new Error('no MCP servers in this test');
  },
  weather: unavailableWeatherSource(),
};

const newMediaDir = () => mkdtemp(path.join(os.tmpdir(), 'fetivi-chat-media-'));

export interface TestApp {
  app: FastifyInstance;
  /** Receives the app's jobs (dropped by default). */
  queue: JobQueue;
  db: Db;
  testDb: TestDatabase;
  clock: { now: () => Date; advance: (ms: number) => void };
  tokens: TokenConfig;
  /** This app's own media directory, removed on close. */
  mediaDir: string;
  close: () => Promise<void>;
}

/** A chat-backend app on its own test database, with a movable clock. */
export async function createTestApp(
  options: { trustProxy?: string; queue?: JobQueue; ferryhopper?: Ferryhopper } = {},
): Promise<TestApp> {
  const queue = options.queue ?? noopQueue;
  const testDb = await createTestDatabase();
  const mediaDir = await newMediaDir();
  let current = START.getTime();
  const clock = {
    now: () => new Date(current),
    advance: (ms: number) => {
      current += ms;
    },
  };
  const tokens: TokenConfig = {
    key: await loadSigningKey(undefined),
    issuer: TEST_ISSUER,
    mcpBaseUrl: TEST_MCP_BASE,
  };
  const app = buildApp({
    db: testDb.db,
    appOrigin: APP_TEST_ORIGIN,
    guestLinkSecret: TEST_GUEST_LINK_SECRET,
    now: clock.now,
    logger: false,
    queue,
    media: createLocalMediaStore(mediaDir),
    trustProxy: options.trustProxy,
    tokens,
    chat: options.ferryhopper ? { ...NO_CHAT, ferryhopper: options.ferryhopper } : NO_CHAT,
  });
  await app.ready();
  return {
    app,
    queue,
    db: testDb.db,
    testDb,
    clock,
    tokens,
    mediaDir,
    close: async () => {
      await app.close();
      await testDb.drop();
      await rm(mediaDir, { recursive: true, force: true });
    },
  };
}

/**
 * An approved property in Europe/Zagreb with one live unit and a Stay on it
 * (check-in 2026-10-21, checkout 2026-10-24, so the PIN works until 2026-10-24T22:00Z).
 */
export async function seedLiveUnit(db: Db, pin = '123456') {
  const hex = () => randomBytes(6).toString('hex');
  const [host] = await db
    .insert(accounts)
    .values({ email: `host-${hex()}@example.test`, passwordHash: 'x', role: 'host' })
    .returning();
  if (!host) throw new Error('no host');
  const [property] = await db
    .insert(properties)
    .values({ hostId: host.id, name: 'Villa Test', timezone: 'Europe/Zagreb', approvedAt: START })
    .returning();
  if (!property) throw new Error('no property');
  const [unit] = await db
    .insert(units)
    .values({ propertyId: property.id, name: 'Apartment Test', qrSlug: hex() })
    .returning();
  if (!unit?.qrSlug) throw new Error('no unit');
  const stay = await registerStay(
    db,
    unit.id,
    { checkIn: '2026-10-21', checkout: '2026-10-24', partySize: 2, bookerName: 'Booker Test' },
    START,
    { pin: () => pin },
  );
  return { slug: unit.qrSlug, pin, stay };
}

export function get(app: FastifyInstance, url: string, cookie?: string) {
  return app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });
}

export function write(
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  app: FastifyInstance,
  url: string,
  body: unknown,
  options: { cookie?: string; origin?: string | null; headers?: Record<string, string> } = {},
) {
  const origin = options.origin === undefined ? APP_TEST_ORIGIN : options.origin;
  return app.inject({
    method,
    url,
    headers: {
      ...(origin ? { origin } : {}),
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...options.headers,
    },
    payload: body as object,
  });
}

/** The `name=value` pair of a cookie set by a response, or undefined. */
export function cookieFrom(response: LightMyRequestResponse, name: string): string | undefined {
  const cookie = response.cookies.find((c) => c.name === name);
  return cookie ? `${name}=${cookie.value}` : undefined;
}

export interface ChatTestApp {
  app: FastifyInstance;
  db: Db;
  /** Moves forward only: the MCP SDK checks token expiry on the real clock. */
  clock: { now: () => Date; advance: (ms: number) => void };
  /** Null in `inprocess` mode: no MCP servers run. */
  mcpApp: FastifyInstance | null;
  /** This app's own media directory, removed on close. */
  mediaDir: string;
  close: () => Promise<void>;
}

/**
 * A chat-backend app wired to the real MCP servers (listening on a free port, trusting this
 * app's key) on one test database. Token audiences stay `http://mcp.test/<server>`; the MCP fetch
 * rewrites that base to the listening port. `probe` mounts a `local` server with one test tool;
 * `queue` receives the tools' jobs (dropped by default). With `transport: 'inprocess'` (V0) no
 * MCP server runs and the MCP fetch throws, so any MCP hop fails the test.
 */
export async function createChatTestApp(options: {
  model: LanguageModel | null;
  probe?: boolean;
  queue?: JobQueue;
  transport?: ToolTransport;
  /** The VAPID public key the push routes serve. */
  pushPublicKey?: string;
  /** The turn's and get_weather's weather; every upstream down by default. */
  weather?: WeatherSource;
  /** The external ferry server (MCP mode only); none by default. */
  ferryhopper?: Ferryhopper;
}): Promise<ChatTestApp> {
  if (options.transport === 'inprocess') return createInProcessChatTestApp(options);
  const weather = options.weather ?? unavailableWeatherSource();
  const testDb = await createTestDatabase();
  const mediaDir = await newMediaDir();
  let current = Date.now();
  const clock = {
    now: () => new Date(current),
    advance: (ms: number) => {
      if (ms < 0) throw new Error('the clock only moves forward');
      current += ms;
    },
  };
  const key = await loadSigningKey(undefined);
  const mcpApp = buildMcpTestApp({
    db: testDb.db,
    keys: createLocalJWKSet({ keys: [key.publicJwk] }),
    issuer: TEST_ISSUER,
    publicBase: TEST_MCP_BASE,
    now: clock.now,
    overrides: options.probe ? { local: buildProbeServer } : {},
    weather,
    ...(options.queue ? { queue: options.queue } : {}),
  });
  await mcpApp.listen({ host: '127.0.0.1', port: 0 });
  const port = (mcpApp.server.address() as AddressInfo).port;
  const testEgress = createEgress({ allowlist: ['127.0.0.1'], allowInsecureLocalhost: true });
  const mcpFetch: Egress['fetch'] = (url, init) =>
    testEgress.fetch(String(url).replace(TEST_MCP_BASE, `http://127.0.0.1:${port}`), init);

  const app = buildApp({
    db: testDb.db,
    appOrigin: APP_TEST_ORIGIN,
    guestLinkSecret: TEST_GUEST_LINK_SECRET,
    now: clock.now,
    logger: false,
    queue: options.queue ?? noopQueue,
    media: createLocalMediaStore(mediaDir),
    tokens: { key, issuer: TEST_ISSUER, mcpBaseUrl: TEST_MCP_BASE },
    chat: {
      model: options.model,
      mcpFetch,
      weather,
      ...(options.ferryhopper ? { ferryhopper: options.ferryhopper } : {}),
    },
    push: { publicKey: options.pushPublicKey ?? null },
  });
  await app.ready();
  return {
    app,
    db: testDb.db,
    clock,
    mcpApp,
    mediaDir,
    close: async () => {
      await app.close();
      await mcpApp.close();
      await testDb.drop();
      await rm(mediaDir, { recursive: true, force: true });
    },
  };
}

async function createInProcessChatTestApp(options: {
  model: LanguageModel | null;
  probe?: boolean;
  queue?: JobQueue;
  weather?: WeatherSource;
}): Promise<ChatTestApp> {
  if (options.probe) throw new Error('the probe server runs only over MCP');
  const weather = options.weather ?? unavailableWeatherSource();
  const testDb = await createTestDatabase();
  const mediaDir = await newMediaDir();
  let current = Date.now();
  const clock = {
    now: () => new Date(current),
    advance: (ms: number) => {
      if (ms < 0) throw new Error('the clock only moves forward');
      current += ms;
    },
  };
  const app = buildApp({
    db: testDb.db,
    appOrigin: APP_TEST_ORIGIN,
    guestLinkSecret: TEST_GUEST_LINK_SECRET,
    now: clock.now,
    logger: false,
    queue: options.queue ?? noopQueue,
    media: createLocalMediaStore(mediaDir),
    tokens: {
      key: await loadSigningKey(undefined),
      issuer: TEST_ISSUER,
      mcpBaseUrl: TEST_MCP_BASE,
    },
    chat: {
      model: options.model,
      mcpFetch: async () => {
        throw new Error('no MCP in process mode');
      },
      tools: inProcessBinding({
        db: testDb.db,
        now: clock.now,
        queue: options.queue ?? noopQueue,
        requestStateSecret: TEST_REQUEST_STATE_SECRET,
        weather,
        webSearch: unavailableWebSearch(),
        embedder: unavailableEmbedder(),
      }),
      weather,
    },
  });
  await app.ready();
  return {
    app,
    db: testDb.db,
    clock,
    mcpApp: null,
    mediaDir,
    close: async () => {
      await app.close();
      await testDb.drop();
      await rm(mediaDir, { recursive: true, force: true });
    },
  };
}

/**
 * Enters a seeded unit's Space through PIN entry, the real path. That opens a second Space next
 * to the seeded one; use the returned Space, not `seed.spaceId`.
 */
export async function enterSpace(
  t: { app: FastifyInstance; db: Db; clock: { now: () => Date } },
  seed: SeededGuestUnit,
  language = 'en',
): Promise<{ cookie: string; space: ResolvedSpace }> {
  const response = await write('POST', t.app, `/api/access/${seed.private.qrSlug}/pin`, {
    pin: seed.pin,
    language,
  });
  if (response.statusCode !== 201) throw new Error(`PIN entry failed: ${response.body}`);
  const cookie = cookieFrom(response, SPACE_COOKIE);
  if (!cookie) throw new Error('no space cookie');
  const space = await resolveSpace(t.db, cookie.slice(SPACE_COOKIE.length + 1), t.clock.now());
  if (!space) throw new Error('no space');
  return { cookie, space };
}

/** The UI message chunks of an SSE response body, up to `[DONE]`. */
export function readStream(response: LightMyRequestResponse): UIMessageChunk[] {
  const chunks: UIMessageChunk[] = [];
  for (const line of response.body.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const data = line.slice('data: '.length);
    if (data === '[DONE]') break;
    chunks.push(JSON.parse(data) as UIMessageChunk);
  }
  return chunks;
}

/** A browser on its own: keeps the cookies the server sets and sends them back. */
export function browser(app: FastifyInstance) {
  const jar = new Map<string, string>();
  const cookie = () => [...jar.values()].join('; ') || undefined;
  const keep = (response: LightMyRequestResponse) => {
    for (const c of response.cookies) {
      if (c.maxAge === 0 || c.value === '') jar.delete(c.name);
      else jar.set(c.name, `${c.name}=${c.value}`);
    }
    return response;
  };
  return {
    jar,
    get: async (url: string) => keep(await get(app, url, cookie())),
    write: async (method: 'POST' | 'PATCH', url: string, body?: unknown, origin?: string | null) =>
      keep(await write(method, app, url, body, { cookie: cookie(), origin })),
  };
}
