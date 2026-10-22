import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

describe('jobs config', () => {
  it('has a dev Provider link secret outside production', () => {
    expect(loadConfig({}).PROVIDER_LINK_SECRET.length).toBeGreaterThanOrEqual(32);
  });

  it('requires a real Provider link secret in production', () => {
    const resend = { MAIL_TRANSPORT: 'resend', RESEND_API_KEY: 're_x' };
    expect(() => loadConfig({ NODE_ENV: 'production', ...resend })).toThrow(/PROVIDER_LINK_SECRET/);
    const secret = 'a'.repeat(40);
    expect(
      loadConfig({ NODE_ENV: 'production', PROVIDER_LINK_SECRET: secret, ...resend })
        .PROVIDER_LINK_SECRET,
    ).toBe(secret);
  });

  it('logs mail by default and needs a Resend key for resend', () => {
    expect(loadConfig({}).MAIL_TRANSPORT).toBe('console');
    expect(() => loadConfig({ MAIL_TRANSPORT: 'resend' })).toThrow(/RESEND_API_KEY/);
    expect(loadConfig({ MAIL_TRANSPORT: 'resend', RESEND_API_KEY: 're_x' }).RESEND_API_KEY).toBe(
      're_x',
    );
  });

  it('requires Resend in production', () => {
    const secret = 'a'.repeat(40);
    expect(() => loadConfig({ NODE_ENV: 'production', PROVIDER_LINK_SECRET: secret })).toThrow(
      /MAIL_TRANSPORT/,
    );
    expect(
      loadConfig({
        NODE_ENV: 'production',
        PROVIDER_LINK_SECRET: secret,
        MAIL_TRANSPORT: 'resend',
        RESEND_API_KEY: 're_x',
      }).MAIL_TRANSPORT,
    ).toBe('resend');
  });

  it('takes both VAPID keys or neither', () => {
    expect(loadConfig({}).VAPID_PUBLIC_KEY).toBeUndefined();
    expect(() => loadConfig({ VAPID_PUBLIC_KEY: 'pub' })).toThrow(/VAPID/);
    expect(
      loadConfig({ VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' }).VAPID_PUBLIC_KEY,
    ).toBe('pub');
  });
});
