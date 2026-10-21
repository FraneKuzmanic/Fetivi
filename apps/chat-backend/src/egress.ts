import { createEgress } from '@fetivi/egress';

// Hosts this process may call. Later tickets add entries.
export const EGRESS_ALLOWLIST: readonly string[] = ['api.anthropic.com'];

export const egress = createEgress({ allowlist: EGRESS_ALLOWLIST });

/** Egress for the MCP servers: their host, plain http allowed for a localhost URL (dev). */
export function mcpEgress(url: URL) {
  return createEgress({
    allowlist: [...EGRESS_ALLOWLIST, url.hostname],
    allowInsecureLocalhost: true,
  });
}
