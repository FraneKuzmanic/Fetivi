import { createDb, createMemoryMailer } from '@fetivi/domain';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { loadConfig } from './config';

// The pg pool connects lazily, so no database is needed for these tests.
const { db, pool } = createDb('postgres://unused@127.0.0.1:1/x');
const deps = { db, mailer: createMemoryMailer(), webOrigin: 'http://host.test', logger: false };

afterAll(async () => {
  await pool.end();
});

describe('backoffice-api', () => {
  it('answers /health', async () => {
    const app = buildApp(deps);
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', service: 'backoffice-api' });
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

  it('has working config defaults', () => {
    expect(loadConfig({})).toEqual({
      HOST: '127.0.0.1',
      PORT: 3001,
      DATABASE_URL: 'postgres://fetivi:fetivi@127.0.0.1:5433/fetivi',
      WEB_ORIGIN: 'http://localhost:5174',
      MAIL_TRANSPORT: 'console',
    });
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow();
  });
});
