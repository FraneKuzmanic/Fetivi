import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { guestClaimsFor, guestTokenClaims } from './claims';
import type { SpaceContext } from './load';

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
