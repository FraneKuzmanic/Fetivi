import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createJobQueue,
  createLocalMediaStore,
  createMemoryMailer,
  type Db,
  ensureQueues,
  type Geocoder,
  type ManualImportModel,
  type ManualModelResult,
  type PaymentGateway,
} from '@fetivi/domain';
import { createTestDatabase, type TestDatabase } from '@fetivi/domain/testing';
import type { FastifyInstance, FastifyPluginAsync, LightMyRequestResponse } from 'fastify';
import { PgBoss } from 'pg-boss';
import { buildApp } from './app';
import { SESSION_COOKIE } from './auth/sessions';

export const TEST_ORIGIN = 'http://host.test';
export const GUEST_TEST_ORIGIN = 'http://guest.test';
export const PASSWORD = 'correct horse battery';

export interface TestApp {
  app: FastifyInstance;
  db: Db;
  testDb: TestDatabase;
  /** Sends only; no worker runs in API tests. */
  boss: PgBoss;
  mailer: ReturnType<typeof createMemoryMailer>;
  clock: { now: () => Date; advance: (ms: number) => void };
  /** This app's own media directory, removed on close. */
  mediaDir: string;
  close: () => Promise<void>;
}

const NOT_CONFIGURED_MODEL: ManualImportModel = {
  extract: async () => ({ ok: false, error: 'not-configured', detail: 'test default' }),
};

/** A manual import model that returns `outputs` in order and records the texts it was given. */
export function scriptedManualModel(outputs: ManualModelResult[]) {
  const queue = [...outputs];
  const calls: string[] = [];
  const model: ManualImportModel & { calls: string[]; push: (r: ManualModelResult) => void } = {
    calls,
    push: (result) => {
      queue.push(result);
    },
    extract: async (text) => {
      calls.push(text);
      const next = queue.shift();
      if (!next) throw new Error('scriptedManualModel: no output left');
      return next;
    },
  };
  return model;
}

/** A back-office app on its own test database, with an in-memory inbox and a movable clock. */
export async function createTestApp(
  options: {
    extraRoutes?: FastifyPluginAsync;
    trustProxy?: string;
    manualImportModel?: ManualImportModel;
    resendWebhookSecret?: string;
    vapidPublicKey?: string;
    stripe?: { gateway: PaymentGateway; webhookSecret?: string };
    geocoder?: Geocoder;
  } = {},
) {
  const testDb = await createTestDatabase();
  const mailer = createMemoryMailer();
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), 'fetivi-bo-media-'));
  const boss = new PgBoss({ connectionString: testDb.url, supervise: false, schedule: false });
  boss.on('error', console.error);
  await boss.start();
  await ensureQueues(boss);
  let current = new Date('2026-10-19T10:00:00Z').getTime();
  const clock = {
    now: () => new Date(current),
    advance: (ms: number) => {
      current += ms;
    },
  };
  const app = buildApp({
    db: testDb.db,
    mailer,
    queue: createJobQueue(boss),
    webOrigin: TEST_ORIGIN,
    guestOrigin: GUEST_TEST_ORIGIN,
    now: clock.now,
    logger: false,
    trustProxy: options.trustProxy,
    media: createLocalMediaStore(mediaDir),
    manualImportModel: options.manualImportModel ?? NOT_CONFIGURED_MODEL,
    resendWebhookSecret: options.resendWebhookSecret,
    vapidPublicKey: options.vapidPublicKey,
    stripe: options.stripe,
    geocoder: options.geocoder ?? null,
  });
  if (options.extraRoutes) app.register(options.extraRoutes);
  await app.ready();
  const t: TestApp = {
    app,
    db: testDb.db,
    testDb,
    boss,
    mailer,
    clock,
    mediaDir,
    close: async () => {
      await app.close();
      await boss.stop({ graceful: false, timeout: 1000 });
      await testDb.drop();
      await rm(mediaDir, { recursive: true, force: true });
    },
  };
  return t;
}

function write(
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  app: FastifyInstance,
  url: string,
  body?: unknown,
  cookie?: string,
) {
  return app.inject({
    method,
    url,
    headers: { origin: TEST_ORIGIN, ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { payload: body as object }),
  });
}

export function post(app: FastifyInstance, url: string, body?: unknown, cookie?: string) {
  return write('POST', app, url, body, cookie);
}

export function patch(app: FastifyInstance, url: string, body?: unknown, cookie?: string) {
  return write('PATCH', app, url, body, cookie);
}

export function put(app: FastifyInstance, url: string, body?: unknown, cookie?: string) {
  return write('PUT', app, url, body, cookie);
}

export function del(app: FastifyInstance, url: string, cookie?: string) {
  return write('DELETE', app, url, undefined, cookie);
}

export function get(app: FastifyInstance, url: string, cookie?: string) {
  return app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });
}

/** The `name=value` pair of the session cookie set by a response. */
export function cookieFrom(response: LightMyRequestResponse): string {
  const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE);
  if (!cookie) throw new Error('response set no session cookie');
  return `${SESSION_COOKIE}=${cookie.value}`;
}

/** The token from the last mail sent. */
export function tokenFrom(mailer: TestApp['mailer']): string {
  const text = mailer.sent.at(-1)?.text ?? '';
  const match = /token=([A-Za-z0-9_-]+)/.exec(text);
  if (!match?.[1]) throw new Error('last mail carries no token');
  return match[1];
}

export async function signUpVerifiedHost(t: TestApp, email: string, password = PASSWORD) {
  await post(t.app, '/api/auth/sign-up', { email, password });
  await post(t.app, '/api/auth/verify-email', { token: tokenFrom(t.mailer) });
}

/** Logs in and returns the session cookie. */
export async function loginAs(t: TestApp, email: string, password = PASSWORD) {
  const response = await post(t.app, '/api/auth/login', { email, password });
  if (response.statusCode !== 200) {
    throw new Error(`login failed: ${response.statusCode} ${response.body}`);
  }
  return cookieFrom(response);
}

/** The property fields of the go-live minimum (ticket 20). */
export const GO_LIVE_PROPERTY = {
  addressLine: 'Obala 1',
  city: 'Trogir',
  checkInTime: '15:00',
  checkoutTime: '10:00',
  checkInMethod: 'lockbox',
  accessInstructions: 'The key box is left of the blue gate.',
  hostPhone: '+385 91 000 0000',
} as const;

/** Fills the go-live minimum of a unit with no blocks, so approval or go-live makes it live. */
export async function fillGoLiveMinimum(
  app: FastifyInstance,
  cookie: string,
  ids: { propertyId: string; unitId: string },
) {
  const property = await patch(
    app,
    `/api/host/properties/${ids.propertyId}`,
    GO_LIVE_PROPERTY,
    cookie,
  );
  if (property.statusCode !== 200) throw new Error(`property patch failed: ${property.body}`);
  const unit = await patch(app, `/api/host/units/${ids.unitId}`, { noWifi: true }, cookie);
  if (unit.statusCode !== 200) throw new Error(`unit patch failed: ${unit.body}`);
}
