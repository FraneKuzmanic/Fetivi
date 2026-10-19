import { describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { loadConfig } from './config';

describe('backoffice-api', () => {
  it('answers /health', async () => {
    const app = buildApp({ logger: false });
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', service: 'backoffice-api' });
    await app.close();
  });

  it('has working config defaults', () => {
    expect(loadConfig({})).toEqual({ HOST: '127.0.0.1', PORT: 3001 });
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow();
  });
});
