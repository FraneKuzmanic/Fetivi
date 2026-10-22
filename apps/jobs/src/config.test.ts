import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

/** The production mail settings that have dev defaults. */
const mail = {
  MAIL_FROM: 'Fetivi <notifications@fetivi.test>',
  GUEST_ORIGIN: 'https://fetivi.test',
  GUEST_LINK_SECRET: 'g'.repeat(40),
};

describe('jobs config', () => {
  it('has a dev Provider link secret outside production', () => {
    expect(loadConfig({}).PROVIDER_LINK_SECRET.length).toBeGreaterThanOrEqual(32);
  });

  it('requires a real Provider link secret in production', () => {
    const resend = { MAIL_TRANSPORT: 'resend', RESEND_API_KEY: 're_x', ...mail };
    expect(() => loadConfig({ NODE_ENV: 'production', ...resend })).toThrow(/PROVIDER_LINK_SECRET/);
    const secret = 'a'.repeat(40);
    expect(
      loadConfig({ NODE_ENV: 'production', PROVIDER_LINK_SECRET: secret, ...resend })
        .PROVIDER_LINK_SECRET,
    ).toBe(secret);
  });

  it('requires a real guest link secret in production', () => {
    expect(loadConfig({}).GUEST_LINK_SECRET.length).toBeGreaterThanOrEqual(32);
    const prod = {
      NODE_ENV: 'production',
      PROVIDER_LINK_SECRET: 'a'.repeat(40),
      MAIL_TRANSPORT: 'resend',
      RESEND_API_KEY: 're_x',
      MAIL_FROM: mail.MAIL_FROM,
      GUEST_ORIGIN: mail.GUEST_ORIGIN,
    };
    expect(() => loadConfig(prod)).toThrow(/GUEST_LINK_SECRET/);
    expect(
      loadConfig({ ...prod, GUEST_LINK_SECRET: mail.GUEST_LINK_SECRET }).GUEST_LINK_SECRET,
    ).toBe(mail.GUEST_LINK_SECRET);
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
    const prod = {
      NODE_ENV: 'production',
      PROVIDER_LINK_SECRET: secret,
      MAIL_TRANSPORT: 'resend',
      RESEND_API_KEY: 're_x',
    };
    expect(loadConfig({ ...prod, ...mail }).MAIL_TRANSPORT).toBe('resend');
  });

  it('requires a real sender and guest origin in production', () => {
    const prod = {
      NODE_ENV: 'production',
      PROVIDER_LINK_SECRET: 'a'.repeat(40),
      MAIL_TRANSPORT: 'resend',
      RESEND_API_KEY: 're_x',
    };
    expect(() => loadConfig({ ...prod, GUEST_ORIGIN: mail.GUEST_ORIGIN })).toThrow(/MAIL_FROM/);
    expect(() => loadConfig({ ...prod, MAIL_FROM: mail.MAIL_FROM })).toThrow(/GUEST_ORIGIN/);
  });

  it('keeps the Jadrolinija feed off unless it is turned on', () => {
    expect(loadConfig({}).JADROLINIJA_RSS_ENABLED).toBe(false);
    expect(loadConfig({ JADROLINIJA_RSS_ENABLED: 'true' }).JADROLINIJA_RSS_ENABLED).toBe(true);
    expect(() => loadConfig({ JADROLINIJA_RSS_ENABLED: 'yes' })).toThrow(/JADROLINIJA/);
  });

  it('has an identifying weather user agent', () => {
    expect(loadConfig({}).WEATHER_USER_AGENT).toMatch(/^Fetivi\//);
  });

  it('takes both VAPID keys or neither', () => {
    expect(loadConfig({}).VAPID_PUBLIC_KEY).toBeUndefined();
    expect(() => loadConfig({ VAPID_PUBLIC_KEY: 'pub' })).toThrow(/VAPID/);
    expect(
      loadConfig({ VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' }).VAPID_PUBLIC_KEY,
    ).toBe('pub');
  });
});
