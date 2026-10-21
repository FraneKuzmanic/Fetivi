import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

describe('jobs config', () => {
  it('has a dev Provider link secret outside production', () => {
    expect(loadConfig({}).PROVIDER_LINK_SECRET.length).toBeGreaterThanOrEqual(32);
  });

  it('requires a real Provider link secret in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/PROVIDER_LINK_SECRET/);
    const secret = 'a'.repeat(40);
    expect(
      loadConfig({ NODE_ENV: 'production', PROVIDER_LINK_SECRET: secret }).PROVIDER_LINK_SECRET,
    ).toBe(secret);
  });
});
