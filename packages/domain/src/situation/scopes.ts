import type { Situation } from './situation';

export const MCP_SERVERS = ['stay', 'local', 'services', 'trip'] as const;
export type McpServerName = (typeof MCP_SERVERS)[number];

/** Every scope a first-party server knows, one per action row of the authorization matrix. */
export const SCOPES = {
  stay: ['unit:read', 'host_message:send'],
  local: ['catalog:read', 'web_fallback:search'],
  services: ['offers:read', 'orders:create', 'orders:read', 'orders:manage'],
  trip: ['plan:read', 'plan:write', 'about_me:read', 'about_me:write'],
} as const satisfies Record<McpServerName, readonly string[]>;
export type Scope<S extends McpServerName = McpServerName> = (typeof SCOPES)[S][number];

type Grant = (s: Situation) => boolean;
const always: Grant = () => true;
const open: Grant = (s) => s.phase !== 'ended';
const offerable: Grant = (s) => open(s) && (s.insideDestination || s.hostHasOwnOffers);

const GRANTS: { [S in McpServerName]: Record<Scope<S>, Grant> } = {
  stay: { 'unit:read': always, 'host_message:send': open },
  local: { 'catalog:read': (s) => s.insideDestination, 'web_fallback:search': always },
  services: {
    'offers:read': offerable,
    'orders:create': offerable,
    'orders:read': always,
    // After checkout the tool limits it to unresolved Orders (ticket 16).
    'orders:manage': always,
  },
  trip: {
    'plan:read': always,
    'plan:write': open,
    'about_me:read': always,
    'about_me:write': open,
  },
};

/**
 * The authorization matrix (architecture §4.3) for one server; order follows SCOPES. Outside a
 * destination with own Offers the Offer scopes are granted while the token's `destination` is
 * null, so the services tools must then show only the host's own Offers. Special-category
 * preferences get no scope at all.
 */
export function scopesFor(server: McpServerName, s: Situation): Scope[] {
  const grants = GRANTS[server] as Record<string, Grant>;
  return (SCOPES[server] as readonly Scope[]).filter((scope) => grants[scope]?.(s));
}

/** `${base without trailing slash}/${server}`: the token audience and the RFC 9728 `resource`. */
export function serverUrl(base: string, server: McpServerName): string {
  return `${base.replace(/\/+$/, '')}/${server}`;
}

/** The `stay` server's unit record resource. */
export const UNIT_RESOURCE_URI = 'fetivi://stay/unit';
