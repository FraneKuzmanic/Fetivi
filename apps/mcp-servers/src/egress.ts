import { VOYAGE_HOST } from '@fetivi/domain/embeddings-vocabulary';
import { createEgress } from '@fetivi/egress';

// Hosts this process may call. Later tickets add entries.
// Weather for get_weather: DHMZ (sea, UV, warnings) and MET Norway (forecast).
// Brave Search for web_fallback_search.
// Voyage AI, embeddings of the guest's search words for catalog search (61).
export const EGRESS_ALLOWLIST: readonly string[] = [
  'vrijeme.hr',
  'meteo.hr',
  'api.met.no',
  'api.search.brave.com',
  VOYAGE_HOST,
];

export const egress = createEgress({ allowlist: EGRESS_ALLOWLIST });

/** Egress for the JWKS only: its host, plain http allowed for a localhost URL (dev). */
export function jwksEgress(url: URL) {
  return createEgress({
    allowlist: [...EGRESS_ALLOWLIST, url.hostname],
    allowInsecureLocalhost: true,
  });
}
