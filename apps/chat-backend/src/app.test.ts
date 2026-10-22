import { createDb, createLocalMediaStore } from '@fetivi/domain';
import { noopQueue } from '@fetivi/domain/testing';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { loadConfig } from './config';
import { EGRESS_ALLOWLIST } from './egress';
import { NO_CHAT } from './testing';
import { loadSigningKey } from './tokens/keys';

// The pg pool connects lazily, so no database is needed for these tests.
const { db, pool } = createDb('postgres://unused@127.0.0.1:1/x');
const tokens = { key: await loadSigningKey(undefined), issuer: 'http://x', mcpBaseUrl: 'http://y' };
const deps = {
  db,
  appOrigin: 'http://app.test',
  guestLinkSecret: 'app-test-guest-link-secret-long-enough',
  logger: false,
  tokens,
  chat: NO_CHAT,
  queue: noopQueue,
  // Nothing is written in these tests.
  media: createLocalMediaStore('unused-media'),
};

afterAll(async () => {
  await pool.end();
});

describe('chat-backend', () => {
  it('answers /health', async () => {
    const app = buildApp(deps);
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', service: 'chat-backend' });
    await app.close();
  });

  it('refuses to start with an /api route that declares no access', async () => {
    const app = buildApp(deps);
    app.register(async (child) => {
      child.get('/api/x', async () => ({}));
    });
    await expect(app.ready()).rejects.toThrow('Route GET /api/x declares no access');
    await app.close();
  });

  // No visitor mode and no preview: without a space only the link check, PIN entry and the
  // emailed links (verification and recovery) work.
  it('has exactly the link check, PIN entry and emailed links as public /api routes', async () => {
    const app = buildApp(deps);
    const routes: { method: string; url: string; access: unknown }[] = [];
    app.addHook('onRoute', (route) => {
      const methods = Array.isArray(route.method) ? route.method : [route.method];
      for (const method of methods) {
        routes.push({ method, url: route.url, access: route.config?.access });
      }
    });
    await app.ready();
    const publicApi = routes
      .filter((r) => r.url.startsWith('/api/') && r.access === 'public' && r.method !== 'HEAD')
      .map((r) => `${r.method} ${r.url}`)
      .sort();
    expect(publicApi).toEqual([
      'GET /api/access/:slug',
      'POST /api/access/:slug/pin',
      'POST /api/access/:slug/recovery',
      'POST /api/email/tips/unsubscribe',
      'POST /api/email/verify',
      'POST /api/recovery/restore',
    ]);
    expect(routes.filter((r) => r.url.startsWith('/api/')).every((r) => r.access)).toBe(true);
    await app.close();
  });

  it('has working config defaults', () => {
    expect(loadConfig({})).toEqual({
      HOST: '127.0.0.1',
      PORT: 3000,
      DATABASE_URL: 'postgres://fetivi:fetivi@127.0.0.1:5433/fetivi',
      APP_ORIGIN: 'http://localhost:5173',
      GUEST_TOKEN_ISSUER: 'http://localhost:3000',
      MCP_PUBLIC_URL: 'http://localhost:3002',
      TOOL_TRANSPORT: 'mcp',
      REQUEST_STATE_SECRET: 'dev-only-request-state-secret-change-me-in-production',
      GUEST_LINK_SECRET: 'dev-only-guest-link-secret-change-me-in-production',
      MEDIA_DIR: '../../.data/media',
      WEATHER_USER_AGENT: 'Fetivi/0.1 (+https://github.com/FraneKuzmanic/Fetivi)',
    });
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow();
  });
});

describe('egress allowlist', () => {
  // AC5: weather comes from DHMZ and MET Norway only; Open-Meteo's licence rules it out.
  it('has the weather hosts and no Open-Meteo', () => {
    expect(EGRESS_ALLOWLIST).toEqual(
      expect.arrayContaining(['vrijeme.hr', 'meteo.hr', 'api.met.no']),
    );
    expect(EGRESS_ALLOWLIST.filter((host) => /open-?meteo/i.test(host))).toEqual([]);
  });
});
