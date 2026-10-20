import { createDb } from '@fetivi/domain';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { loadConfig } from './config';
import { createTestKeys } from './testing';

// The pg pool connects lazily, so no database is needed for these tests.
const { db, pool } = createDb('postgres://unused@127.0.0.1:1/x');
const keys = await createTestKeys();

afterAll(async () => {
  await pool.end();
});

describe('mcp-servers', () => {
  const config = loadConfig({});
  const deps = { config, db, keys: keys.keys };

  it('answers /health for an allowed Host header', async () => {
    const app = buildApp(deps);
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { host: 'localhost:3002' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', service: 'mcp-servers' });
    await app.close();
  });

  it('rejects an unknown Host header', async () => {
    const app = buildApp(deps);
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { host: 'evil.example.com' },
    });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('parses the allowed hosts list', () => {
    expect(config.MCP_ALLOWED_HOSTS).toEqual(['localhost', '127.0.0.1']);
    expect(loadConfig({ MCP_ALLOWED_HOSTS: ' mcp.fetivi.test , ' }).MCP_ALLOWED_HOSTS).toEqual([
      'mcp.fetivi.test',
    ]);
    expect(() => loadConfig({ PORT: 'abc' })).toThrow();
  });

  it('has working token and JWKS defaults', () => {
    expect(config).toMatchObject({
      DATABASE_URL: 'postgres://fetivi:fetivi@127.0.0.1:5433/fetivi',
      MCP_PUBLIC_URL: 'http://localhost:3002',
      GUEST_TOKEN_ISSUER: 'http://localhost:3000',
      GUEST_TOKEN_JWKS_URL: 'http://127.0.0.1:3000/.well-known/jwks.json',
    });
    expect(() => loadConfig({ GUEST_TOKEN_JWKS_URL: 'not a url' })).toThrow();
  });
});
