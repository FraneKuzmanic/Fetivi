import { exportPKCS8, generateKeyPair } from 'jose';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config';
import { loadSigningKey } from './keys';

describe('guest token config', () => {
  it('requires a signing key in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow('GUEST_TOKEN_PRIVATE_KEY');
    expect(loadConfig({ NODE_ENV: 'production', GUEST_TOKEN_PRIVATE_KEY: 'pem' })).toMatchObject({
      GUEST_TOKEN_PRIVATE_KEY: 'pem',
    });
    expect(loadConfig({}).GUEST_TOKEN_PRIVATE_KEY).toBeUndefined();
  });
});

describe('loadSigningKey', () => {
  it('makes an ephemeral key whose public JWK has no private part', async () => {
    const key = await loadSigningKey(undefined);
    expect(key.ephemeral).toBe(true);
    expect(key.publicJwk).toEqual({
      kty: 'EC',
      crv: 'P-256',
      x: expect.any(String),
      y: expect.any(String),
      kid: key.kid,
      alg: 'ES256',
      use: 'sig',
    });
    expect(key.publicJwk).not.toHaveProperty('d');
  });

  it('loads a PKCS8 PEM with a stable kid, also with escaped newlines', async () => {
    const { privateKey } = await generateKeyPair('ES256', { extractable: true });
    const pem = await exportPKCS8(privateKey);
    const a = await loadSigningKey(pem);
    const b = await loadSigningKey(pem.replaceAll('\n', '\\n'));
    expect(a.ephemeral).toBe(false);
    expect(a.kid).toBe(b.kid);
    expect(a.publicJwk).toEqual(b.publicJwk);
    expect(a.publicJwk).not.toHaveProperty('d');
    expect((await loadSigningKey(undefined)).kid).not.toBe(a.kid);
  });
});
