import { createEgress } from '@fetivi/egress';

// Hosts this process may call. Later tickets add entries.
export const EGRESS_ALLOWLIST: readonly string[] = [];

export const egress = createEgress({ allowlist: EGRESS_ALLOWLIST });

/** Egress for the JWKS only: its host, plain http allowed for a localhost URL (dev). */
export function jwksEgress(url: URL) {
  return createEgress({
    allowlist: [...EGRESS_ALLOWLIST, url.hostname],
    allowInsecureLocalhost: true,
  });
}
