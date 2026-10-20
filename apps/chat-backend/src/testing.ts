import { randomBytes } from 'node:crypto';
import { accounts, type Db, properties, registerStay, units } from '@fetivi/domain';
import { createTestDatabase, type TestDatabase } from '@fetivi/domain/testing';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from './app';

export const APP_TEST_ORIGIN = 'http://app.test';
export const START = new Date('2026-10-19T10:00:00Z');

export interface TestApp {
  app: FastifyInstance;
  db: Db;
  testDb: TestDatabase;
  clock: { now: () => Date; advance: (ms: number) => void };
  close: () => Promise<void>;
}

/** A chat-backend app on its own test database, with a movable clock. */
export async function createTestApp(options: { trustProxy?: string } = {}): Promise<TestApp> {
  const testDb = await createTestDatabase();
  let current = START.getTime();
  const clock = {
    now: () => new Date(current),
    advance: (ms: number) => {
      current += ms;
    },
  };
  const app = buildApp({
    db: testDb.db,
    appOrigin: APP_TEST_ORIGIN,
    now: clock.now,
    logger: false,
    trustProxy: options.trustProxy,
  });
  await app.ready();
  return {
    app,
    db: testDb.db,
    testDb,
    clock,
    close: async () => {
      await app.close();
      await testDb.drop();
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
  method: 'POST' | 'PATCH',
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
