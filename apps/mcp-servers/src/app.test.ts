import { describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { loadConfig } from './config';

describe('mcp-servers', () => {
  const config = loadConfig({});

  it('answers /health for an allowed Host header', async () => {
    const app = buildApp(config);
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
    const app = buildApp(config);
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
});
