import { describe, expect, it } from 'vitest';
import { hashToken } from '../../tokens';
import { PROVIDER_LINK_TOKEN, providerLinkToken, providerLinkUrl } from './token';

const SECRET = 'a-test-secret-that-is-long-enough-for-hmac';
const ORDER = '6f1c1e4e-6d1f-4a39-9b52-0d1f7e2a3b4c';
const OTHER = '7a2d2f5f-7e2a-4b4a-8c63-1e2a8f3b4c5d';

describe('providerLinkToken', () => {
  it('is the same for the same secret and Order', () => {
    expect(providerLinkToken(SECRET, ORDER)).toBe(providerLinkToken(SECRET, ORDER));
  });

  it('differs per Order and per secret', () => {
    expect(providerLinkToken(SECRET, ORDER)).not.toBe(providerLinkToken(SECRET, OTHER));
    expect(providerLinkToken(SECRET, ORDER)).not.toBe(providerLinkToken(`${SECRET}x`, ORDER));
  });

  it('is 43 base64url characters and not its own hash', () => {
    const token = providerLinkToken(SECRET, ORDER);
    expect(token).toMatch(PROVIDER_LINK_TOKEN);
    expect(token).not.toContain(ORDER);
    expect(hashToken(token)).not.toBe(token);
    expect(hashToken(token)).not.toMatch(PROVIDER_LINK_TOKEN);
  });
});

describe('providerLinkUrl', () => {
  it('puts the token under the public API path', () => {
    expect(providerLinkUrl('https://host.fetivi.test/', 'abc')).toBe(
      'https://host.fetivi.test/api/provider-link/abc',
    );
  });
});
