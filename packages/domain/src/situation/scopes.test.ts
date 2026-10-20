import { describe, expect, it } from 'vitest';
import type { StayPhase } from '../stays/rules';
import { MCP_SERVERS, SCOPES, scopesFor, serverUrl } from './scopes';

const PHASES: StayPhase[] = ['upcoming', 'in_stay', 'ended'];
const cases = PHASES.flatMap((phase) =>
  [true, false].flatMap((insideDestination) =>
    [true, false].map((hostHasOwnOffers) => ({ phase, insideDestination, hostHasOwnOffers })),
  ),
);

describe('scopesFor', () => {
  it.each(cases)('follows the authorization matrix for %o', (s) => {
    const open = s.phase !== 'ended';
    const offerable = open && (s.insideDestination || s.hostHasOwnOffers);
    const expected = {
      stay: ['unit:read', ...(open ? ['host_message:send'] : [])],
      local: [...(s.insideDestination ? ['catalog:read'] : []), 'web_fallback:search'],
      services: [
        ...(offerable ? ['offers:read', 'orders:create'] : []),
        'orders:read',
        'orders:manage',
      ],
      trip: open
        ? ['plan:read', 'plan:write', 'about_me:read', 'about_me:write']
        : ['plan:read', 'about_me:read'],
    };
    for (const server of MCP_SERVERS) {
      expect(scopesFor(server, s)).toEqual(expected[server]);
    }
  });

  it('only grants scopes the server declares', () => {
    for (const server of MCP_SERVERS) {
      const all = scopesFor(server, {
        phase: 'in_stay',
        insideDestination: true,
        hostHasOwnOffers: true,
      });
      expect(all).toEqual([...SCOPES[server]]);
    }
  });
});

describe('serverUrl', () => {
  it('joins the base and the server name', () => {
    expect(serverUrl('https://mcp.x/', 'stay')).toBe('https://mcp.x/stay');
    expect(serverUrl('http://localhost:3002', 'trip')).toBe('http://localhost:3002/trip');
  });
});
