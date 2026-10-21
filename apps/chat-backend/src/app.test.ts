import { createDb } from '@fetivi/domain';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { loadConfig } from './config';
import { NO_CHAT } from './testing';
import { loadSigningKey } from './tokens/keys';

// The pg pool connects lazily, so no database is needed for these tests.
const { db, pool } = createDb('postgres://unused@127.0.0.1:1/x');
const tokens = { key: await loadSigningKey(undefined), issuer: 'http://x', mcpBaseUrl: 'http://y' };
const deps = { db, appOrigin: 'http://app.test', logger: false, tokens, chat: NO_CHAT };

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

  // No visitor mode and no preview: only the link check and PIN entry work without a space.
  it('has exactly two public /api routes: the link check and PIN entry', async () => {
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
    expect(publicApi).toEqual(['GET /api/access/:slug', 'POST /api/access/:slug/pin']);
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
    });
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow();
  });
});
