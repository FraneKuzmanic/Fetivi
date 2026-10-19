import { describe, expect, it } from 'vitest';
import { hashToken, newToken } from './tokens';

describe('tokens', () => {
  it('are 43 base64url characters and unique', () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const token = newToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      tokens.add(token);
    }
    expect(tokens.size).toBe(1000);
  });

  it('hash to a stable 64-character hex string', () => {
    const token = newToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).not.toBe(hashToken(newToken()));
  });
});
