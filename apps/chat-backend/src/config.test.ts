import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const PROD = {
  NODE_ENV: 'production',
  GUEST_TOKEN_PRIVATE_KEY: 'pem',
  GUEST_LINK_SECRET: 'prod-guest-link-secret-at-least-32-chars',
};

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

describe('chat-backend config: FERRYHOPPER_MCP_URL', () => {
  it("defaults to Ferryhopper's public server, and empty disables it", () => {
    expect(loadConfig({}).FERRYHOPPER_MCP_URL).toBe('https://mcp.ferryhopper.com/mcp');
    expect(loadConfig({ FERRYHOPPER_MCP_URL: '' }).FERRYHOPPER_MCP_URL).toBeUndefined();
  });
});

describe('chat-backend config: GUEST_LINK_SECRET', () => {
  it('has a dev default and refuses it in production', () => {
    expect(loadConfig({}).GUEST_LINK_SECRET.length).toBeGreaterThanOrEqual(32);
    const { GUEST_LINK_SECRET: _, ...prodWithout } = PROD;
    expect(() => loadConfig(prodWithout)).toThrow(/GUEST_LINK_SECRET is required in production/);
    expect(loadConfig(PROD).GUEST_LINK_SECRET).toBe(PROD.GUEST_LINK_SECRET);
  });
});
