import { GUEST_TOKEN_ALG, GUEST_TOKEN_TYPE, guestTokenClaims, identityOf } from '@fetivi/domain';
import {
  type AuthInfo,
  OAuthError,
  OAuthErrorCode,
  type OAuthTokenVerifier,
} from '@modelcontextprotocol/server';
import { type JWTVerifyGetKey, jwtVerify } from 'jose';

export const GUEST_CLIENT_ID = 'fetivi-chat-backend';

/**
 * Verifies a guest token for one server: signature through the JWKS, issuer, this server's
 * audience, `typ` and expiry, then the claims. Runs on the real clock (the SDK checks
 * `expiresAt` against `Date.now()` too). Any failure is `invalid_token`, with no detail.
 */
export function createGuestTokenVerifier(opts: {
  keys: JWTVerifyGetKey;
  issuer: string;
  audience: string;
}): OAuthTokenVerifier {
  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      try {
        const { payload } = await jwtVerify(token, opts.keys, {
          issuer: opts.issuer,
          audience: opts.audience,
          algorithms: [GUEST_TOKEN_ALG],
          typ: GUEST_TOKEN_TYPE,
        });
        const claims = guestTokenClaims.parse(payload);
        const identity = identityOf(claims);
        return {
          token,
          clientId: GUEST_CLIENT_ID,
          scopes: identity.scopes,
          expiresAt: claims.exp,
          resource: new URL(claims.aud),
          extra: { identity },
        };
      } catch {
        throw new OAuthError(OAuthErrorCode.InvalidToken, 'invalid token');
      }
    },
  };
}
