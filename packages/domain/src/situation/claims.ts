import { z } from 'zod';
import { GUEST_LANGUAGES, type GuestLanguage } from '../property/vocabulary';

// The guest token contract, shared by the minter (chat backend) and the verifier (mcp-servers).

export const GUEST_TOKEN_TTL_SECONDS = 300;
/** RFC 9068 JWT access token. */
export const GUEST_TOKEN_TYPE = 'at+jwt';
export const GUEST_TOKEN_ALG = 'ES256';

export const guestTokenClaims = z.object({
  iss: z.string(),
  /** One server's canonical URL: one server per token. */
  aud: z.string(),
  /** The space id. */
  sub: z.uuid(),
  iat: z.number().int(),
  exp: z.number().int(),
  stay: z.uuid(),
  unit: z.uuid(),
  property: z.uuid(),
  destination: z.uuid().nullable(),
  lang: z.enum(GUEST_LANGUAGES),
  /** RFC 9068: space-separated. */
  scope: z.string(),
});
export type GuestTokenClaims = z.infer<typeof guestTokenClaims>;

/** What a server knows about its caller: identity from the token, never from arguments. */
export interface GuestIdentity {
  spaceId: string;
  stayId: string;
  unitId: string;
  propertyId: string;
  destinationId: string | null;
  language: GuestLanguage;
  scopes: string[];
}

export function identityOf(c: GuestTokenClaims): GuestIdentity {
  return {
    spaceId: c.sub,
    stayId: c.stay,
    unitId: c.unit,
    propertyId: c.property,
    destinationId: c.destination,
    language: c.lang,
    scopes: c.scope.split(' ').filter(Boolean),
  };
}
