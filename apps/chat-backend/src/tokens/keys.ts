import { GUEST_TOKEN_ALG } from '@fetivi/domain';
import {
  type CryptoKey,
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
  importPKCS8,
  type JWK,
} from 'jose';

export interface SigningKey {
  privateKey: CryptoKey;
  kid: string;
  /** kty, crv, x, y, kid, alg, use; never the private part `d`. */
  publicJwk: JWK;
  /** True when no key was configured and this process made its own. */
  ephemeral: boolean;
}

/**
 * The guest token signing key from a PKCS8 PEM, or a fresh key for this process when none is
 * configured (dev and tests; the config requires one in production). An ephemeral key survives
 * no restart, which is fine: the MCP servers re-fetch the JWKS on an unknown `kid`.
 */
export async function loadSigningKey(pem: string | undefined): Promise<SigningKey> {
  const privateKey = pem
    ? await importPKCS8(pem.replaceAll('\\n', '\n'), GUEST_TOKEN_ALG, { extractable: true })
    : (await generateKeyPair(GUEST_TOKEN_ALG, { extractable: true })).privateKey;
  const { kty, crv, x, y } = await exportJWK(privateKey);
  const base: JWK = { kty, crv, x, y };
  const kid = await calculateJwkThumbprint(base);
  return {
    privateKey,
    kid,
    publicJwk: { ...base, kid, alg: GUEST_TOKEN_ALG, use: 'sig' },
    ephemeral: !pem,
  };
}
