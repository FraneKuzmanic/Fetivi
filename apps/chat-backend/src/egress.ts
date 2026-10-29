import { VOYAGE_HOST } from '@fetivi/domain/embeddings-vocabulary';
import { createEgress } from '@fetivi/egress';

// Hosts this process may call. Later tickets add entries.
// Weather (DHMZ and MET Norway): the turn's weather note, and V0's get_weather.
// Brave Search: V0's web_fallback_search.
// Ferryhopper: the external ferry server (V1 only).
// Voyage AI: embeddings of the guest's search words for V0's catalog search (61).
export const EGRESS_ALLOWLIST: readonly string[] = [
  'api.anthropic.com',
  'vrijeme.hr',
  'meteo.hr',
  'api.met.no',
  'api.search.brave.com',
  'mcp.ferryhopper.com',
  VOYAGE_HOST,
];

export const egress = createEgress({ allowlist: EGRESS_ALLOWLIST });

/** Egress for the MCP servers: only their host, plain http allowed for a localhost URL (dev). */
export function mcpEgress(url: URL) {
  return createEgress({
    allowlist: [url.hostname],
    allowInsecureLocalhost: true,
  });
}
