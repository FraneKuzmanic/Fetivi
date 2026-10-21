import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const PROD = { NODE_ENV: 'production', GUEST_TOKEN_PRIVATE_KEY: 'pem' };

describe('chat-backend config: TOOL_TRANSPORT', () => {
  it('defaults to mcp', () => {
    expect(loadConfig({}).TOOL_TRANSPORT).toBe('mcp');
    expect(loadConfig(PROD).TOOL_TRANSPORT).toBe('mcp');
  });

  it('accepts inprocess outside production', () => {
    const config = loadConfig({ TOOL_TRANSPORT: 'inprocess' });
    expect(config.TOOL_TRANSPORT).toBe('inprocess');
    expect(config.REQUEST_STATE_SECRET.length).toBeGreaterThanOrEqual(32);
  });

  it('refuses inprocess in production', () => {
    expect(() => loadConfig({ ...PROD, TOOL_TRANSPORT: 'inprocess' })).toThrow(
      /TOOL_TRANSPORT must be mcp in production/,
    );
  });

  it('refuses an unknown value', () => {
    expect(() => loadConfig({ TOOL_TRANSPORT: 'http' })).toThrow(/TOOL_TRANSPORT/);
  });
});
