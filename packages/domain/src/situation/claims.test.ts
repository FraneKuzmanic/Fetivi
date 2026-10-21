import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { guestClaimsFor, guestIdentityFor, guestTokenClaims, identityOf } from './claims';
import type { SpaceContext } from './load';
import { MCP_SERVERS } from './scopes';

const ctx: SpaceContext = {
  phase: 'ended',
  insideDestination: false,
  hostHasOwnOffers: true,
  spaceId: randomUUID(),
  stayId: randomUUID(),
  unitId: randomUUID(),
  propertyId: randomUUID(),
  destinationId: null,
  language: 'de',
};

describe('guestClaimsFor', () => {
  it('carries the ids, language and the server scopes, and parses as a guest token', () => {
    const claims = guestClaimsFor('services', ctx);
    expect(claims).toEqual({
      stay: ctx.stayId,
      unit: ctx.unitId,
      property: ctx.propertyId,
      destination: null,
      lang: 'de',
      scope: 'orders:read orders:manage',
    });
    const registered = { iss: 'i', aud: 'a', sub: ctx.spaceId, iat: 1, exp: 301 };
    expect(guestTokenClaims.parse({ ...registered, ...claims })).toMatchObject(claims);
  });
});

describe('guestIdentityFor', () => {
  const inside: SpaceContext = {
    ...ctx,
    phase: 'in_stay',
    insideDestination: true,
    destinationId: randomUUID(),
  };

  it.each(MCP_SERVERS.flatMap((server) => [[server, inside] as const, [server, ctx] as const]))(
    'equals the identity a %s token would carry',
    (server, c) => {
      const registered = { iss: 'i', aud: 'a', sub: c.spaceId, iat: 1, exp: 301 };
      const claims = guestTokenClaims.parse({ ...registered, ...guestClaimsFor(server, c) });
      expect(guestIdentityFor(server, c)).toEqual(identityOf(claims));
    },
  );
});
