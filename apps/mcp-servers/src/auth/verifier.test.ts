import { randomUUID } from 'node:crypto';
import { type SpaceContext, serverUrl } from '@fetivi/domain';
import { OAuthError } from '@modelcontextprotocol/server';
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { createTestKeys, signToken, TEST_BASE, TEST_ISSUER } from '../testing';
import { createGuestTokenVerifier } from './verifier';

const keys = await createTestKeys();
const ctx: SpaceContext = {
  phase: 'in_stay',
  insideDestination: true,
  hostHasOwnOffers: false,
  spaceId: randomUUID(),
  stayId: randomUUID(),
  unitId: randomUUID(),
  propertyId: randomUUID(),
  destinationId: randomUUID(),
  language: 'hr',
  closed: false,
};
const audience = serverUrl(TEST_BASE, 'stay');
const verifier = createGuestTokenVerifier({ keys: keys.keys, issuer: TEST_ISSUER, audience });
const now = () => Math.floor(Date.now() / 1000);

async function rejection(token: string) {
  try {
    await verifier.verifyAccessToken(token);
    return 'accepted';
  } catch (error) {
    return error instanceof OAuthError ? `${error.code}: ${error.message}` : String(error);
  }
}

describe('createGuestTokenVerifier', () => {
  it('turns a valid token into AuthInfo with the identity', async () => {
    const token = await signToken(keys, { server: 'stay', ctx });
    const info = await verifier.verifyAccessToken(token);
    expect(info).toEqual({
      token,
      clientId: 'fetivi-chat-backend',
      scopes: ['unit:read', 'host_message:send'],
      expiresAt: expect.any(Number),
      resource: new URL(audience),
      extra: {
        identity: {
          spaceId: ctx.spaceId,
          stayId: ctx.stayId,
          unitId: ctx.unitId,
          propertyId: ctx.propertyId,
          destinationId: ctx.destinationId,
          language: 'hr',
          scopes: ['unit:read', 'host_message:send'],
        },
      },
    });
    expect(info.expiresAt).toBeGreaterThan(now());
  });

  const invalid: [string, () => Promise<string>][] = [
    ['another server audience', () => signToken(keys, { server: 'local', ctx })],
    [
      'a foreign audience',
      () => signToken(keys, { server: 'stay', ctx, aud: 'https://evil.example/stay' }),
    ],
    ['another issuer', () => signToken(keys, { server: 'stay', ctx, iss: 'http://evil.test' })],
    [
      'an expired token',
      () => signToken(keys, { server: 'stay', ctx, iat: now() - 600, exp: now() - 300 }),
    ],
    [
      'a foreign key',
      async () =>
        signToken(keys, { server: 'stay', ctx, key: (await createTestKeys()).privateKey }),
    ],
    ['no typ', () => signToken(keys, { server: 'stay', ctx, header: { typ: undefined } })],
    ['typ JWT', () => signToken(keys, { server: 'stay', ctx, header: { typ: 'JWT' } })],
    [
      'missing stay claim',
      () => signToken(keys, { server: 'stay', ctx, claims: { stay: undefined } }),
    ],
    ['a non-uuid unit', () => signToken(keys, { server: 'stay', ctx, claims: { unit: 'unit-1' } })],
    ['an unknown language', () => signToken(keys, { server: 'stay', ctx, claims: { lang: 'xx' } })],
    [
      'HS256',
      () =>
        new SignJWT({ stay: ctx.stayId })
          .setProtectedHeader({ alg: 'HS256', typ: 'at+jwt', kid: keys.kid })
          .setIssuer(TEST_ISSUER)
          .setAudience(audience)
          .setSubject(ctx.spaceId)
          .setIssuedAt()
          .setExpirationTime('5m')
          .sign(new TextEncoder().encode('a-shared-secret-of-enough-length-000')),
    ],
    [
      'alg none',
      async () => {
        const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
        const payload = { iss: TEST_ISSUER, aud: audience, sub: ctx.spaceId, exp: now() + 300 };
        return `${b64({ alg: 'none', typ: 'at+jwt' })}.${b64(payload)}.`;
      },
    ],
    ['garbage', async () => 'not.a.jwt'],
  ];

  it.each(invalid)('refuses %s as invalid_token', async (_label, make) => {
    expect(await rejection(await make())).toBe('invalid_token: invalid token');
  });
});
