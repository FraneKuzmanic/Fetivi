import { randomUUID } from 'node:crypto';
import { destinations, loadSituation, MCP_SERVERS, scopesFor, serverUrl } from '@fetivi/domain';
import { seedGuestUnit, TROGIR } from '@fetivi/domain/testing';
import { createLocalJWKSet, decodeProtectedHeader, type JSONWebKeySet, jwtVerify } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, START, TEST_ISSUER, TEST_MCP_BASE, type TestApp } from '../testing';
import { mintTurnTokens } from './mint';

let t: TestApp;
let destinationId: string;

beforeAll(async () => {
  t = await createTestApp();
  const [d] = await t.db
    .insert(destinations)
    .values({ name: `Trogir ${randomUUID()}`, centre: TROGIR, radiusM: 10_000 })
    .returning();
  if (!d) throw new Error('no destination');
  destinationId = d.id;
});

afterAll(async () => {
  await t?.close();
});

async function jwks() {
  const response = await t.app.inject({ method: 'GET', url: '/.well-known/jwks.json' });
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('public, max-age=300');
  return createLocalJWKSet(response.json<JSONWebKeySet>());
}

describe('GET /.well-known/jwks.json', () => {
  it('serves the public key only', async () => {
    const response = await t.app.inject({ method: 'GET', url: '/.well-known/jwks.json' });
    const body = response.json<JSONWebKeySet>();
    expect(body.keys).toHaveLength(1);
    expect(body.keys[0]).toMatchObject({
      kty: 'EC',
      crv: 'P-256',
      alg: 'ES256',
      kid: t.tokens.key.kid,
    });
    expect(body.keys[0]).not.toHaveProperty('d');
  });
});

describe('mintTurnTokens', () => {
  it('mints one verifiable token per server with the situation scopes', async () => {
    const seed = await seedGuestUnit(t.db, { now: START, spaceLanguage: 'it' });
    const tokens = await mintTurnTokens(t.tokens, t.db, seed.spaceId, t.clock.now());
    if (!tokens) throw new Error('no tokens');
    expect(Object.keys(tokens).sort()).toEqual([...MCP_SERVERS].sort());

    const keys = await jwks();
    const situation = await loadSituation(t.db, seed.spaceId, t.clock.now());
    if (!situation) throw new Error('no situation');
    for (const server of MCP_SERVERS) {
      const { payload, protectedHeader } = await jwtVerify(tokens[server], keys, {
        issuer: TEST_ISSUER,
        audience: serverUrl(TEST_MCP_BASE, server),
        typ: 'at+jwt',
        algorithms: ['ES256'],
        currentDate: t.clock.now(),
      });
      expect(protectedHeader).toEqual({ alg: 'ES256', typ: 'at+jwt', kid: t.tokens.key.kid });
      expect(payload).toEqual({
        iss: TEST_ISSUER,
        aud: serverUrl(TEST_MCP_BASE, server),
        sub: seed.spaceId,
        iat: Math.floor(START.getTime() / 1000),
        exp: Math.floor(START.getTime() / 1000) + 300,
        stay: seed.stayId,
        unit: seed.unitId,
        property: seed.propertyId,
        destination: destinationId,
        lang: 'it',
        scope: scopesFor(server, situation).join(' '),
      });
      // No host-only Stay data in the token.
      const raw = Buffer.from(tokens[server].split('.')[1] ?? '', 'base64url').toString();
      for (const value of [seed.pin, seed.private.bookerName, ...Object.values(seed.secrets)]) {
        expect(raw).not.toContain(value);
      }
    }
    expect(decodeProtectedHeader(tokens.stay).kid).toBe(t.tokens.key.kid);
  });

  it('carries the reduced scopes after checkout', async () => {
    const seed = await seedGuestUnit(t.db, { now: START });
    const after = seed.stay.activeUntil;
    const tokens = await mintTurnTokens(t.tokens, t.db, seed.spaceId, after);
    if (!tokens) throw new Error('no tokens');
    const keys = await jwks();
    const scope = async (server: (typeof MCP_SERVERS)[number]) =>
      (
        await jwtVerify(tokens[server], keys, {
          audience: serverUrl(TEST_MCP_BASE, server),
          currentDate: after,
        })
      ).payload.scope;
    expect(await scope('stay')).toBe('unit:read');
    expect(await scope('trip')).toBe('plan:read about_me:read');
    expect(await scope('services')).toBe('orders:read orders:manage');
  });

  it('binds each token to its own audience', async () => {
    const seed = await seedGuestUnit(t.db, { now: START });
    const tokens = await mintTurnTokens(t.tokens, t.db, seed.spaceId, t.clock.now());
    if (!tokens) throw new Error('no tokens');
    await expect(
      jwtVerify(tokens.stay, await jwks(), {
        audience: serverUrl(TEST_MCP_BASE, 'local'),
        currentDate: t.clock.now(),
      }),
    ).rejects.toThrow();
  });

  it('expires after five minutes', async () => {
    const seed = await seedGuestUnit(t.db, { now: START });
    const tokens = await mintTurnTokens(t.tokens, t.db, seed.spaceId, t.clock.now());
    if (!tokens) throw new Error('no tokens');
    await expect(
      jwtVerify(tokens.stay, await jwks(), {
        currentDate: new Date(t.clock.now().getTime() + 301_000),
      }),
    ).rejects.toThrow('"exp" claim timestamp check failed');
  });

  it('returns null for an unknown space', async () => {
    expect(await mintTurnTokens(t.tokens, t.db, randomUUID(), t.clock.now())).toBeNull();
  });
});
