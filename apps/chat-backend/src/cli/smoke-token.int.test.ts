import { SPACE_COOKIE, serverUrl } from '@fetivi/domain';
import { seedGuestUnit } from '@fetivi/domain/testing';
import { createLocalJWKSet, type JSONWebKeySet, jwtVerify } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestApp,
  enterSpace,
  START,
  TEST_ISSUER,
  TEST_MCP_BASE,
  type TestApp,
} from '../testing';
import { smokeToken } from './smoke-token';

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
});

afterAll(async () => {
  await t?.close();
});

describe('smokeToken', () => {
  it('mints a stay token for the Space behind a cookie token', async () => {
    const seed = await seedGuestUnit(t.db, { now: START });
    const { cookie, space } = await enterSpace(t, seed);
    const spaceToken = cookie.slice(SPACE_COOKIE.length + 1);

    const token = await smokeToken(t.db, t.tokens, spaceToken, t.clock.now());
    if (!token) throw new Error('no token');

    const response = await t.app.inject({ method: 'GET', url: '/.well-known/jwks.json' });
    const keys = createLocalJWKSet(response.json<JSONWebKeySet>());
    const { payload } = await jwtVerify(token, keys, {
      issuer: TEST_ISSUER,
      audience: serverUrl(TEST_MCP_BASE, 'stay'),
      algorithms: ['ES256'],
      currentDate: t.clock.now(),
    });
    expect(payload.sub).toBe(space.space.id);
  });

  it('returns null for an unknown token', async () => {
    expect(await smokeToken(t.db, t.tokens, 'not-a-space-token', t.clock.now())).toBeNull();
  });
});
