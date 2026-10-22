import { createEgress } from '@fetivi/egress';

// Hosts this process may call. Later tickets add entries.
// Weather (DHMZ and MET Norway): the turn's weather note, and V0's get_weather.
export const EGRESS_ALLOWLIST: readonly string[] = [
  'api.anthropic.com',
  'vrijeme.hr',
  'meteo.hr',
  'api.met.no',
];

export const egress = createEgress({ allowlist: EGRESS_ALLOWLIST });

/** Egress for the MCP servers: only their host, plain http allowed for a localhost URL (dev). */
export function mcpEgress(url: URL) {
  return createEgress({
    allowlist: [url.hostname],
    allowInsecureLocalhost: true,
  });
}
