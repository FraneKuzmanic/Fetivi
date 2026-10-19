import { createMemoryMailer, type Db } from '@fetivi/domain';
import { createTestDatabase, type TestDatabase } from '@fetivi/domain/testing';
import type { FastifyInstance, FastifyPluginAsync, LightMyRequestResponse } from 'fastify';
import { buildApp } from './app';
import { SESSION_COOKIE } from './auth/sessions';

export const TEST_ORIGIN = 'http://host.test';
export const PASSWORD = 'correct horse battery';

export interface TestApp {
  app: FastifyInstance;
  db: Db;
  testDb: TestDatabase;
  mailer: ReturnType<typeof createMemoryMailer>;
  clock: { now: () => Date; advance: (ms: number) => void };
  close: () => Promise<void>;
}

/** A back-office app on its own test database, with an in-memory inbox and a movable clock. */
export async function createTestApp(options: { extraRoutes?: FastifyPluginAsync } = {}) {
  const testDb = await createTestDatabase();
  const mailer = createMemoryMailer();
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
    webOrigin: TEST_ORIGIN,
    now: clock.now,
    logger: false,
  });
  if (options.extraRoutes) app.register(options.extraRoutes);
  await app.ready();
  const t: TestApp = {
    app,
    db: testDb.db,
    testDb,
    mailer,
    clock,
    close: async () => {
      await app.close();
      await testDb.drop();
    },
  };
  return t;
}

export function post(app: FastifyInstance, url: string, body?: unknown, cookie?: string) {
  return app.inject({
    method: 'POST',
    url,
    headers: { origin: TEST_ORIGIN, ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { payload: body as object }),
  });
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
