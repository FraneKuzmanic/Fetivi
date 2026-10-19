import { createEgress } from '@fetivi/egress';

// Hosts this process may call. Later tickets add entries.
export const EGRESS_ALLOWLIST: readonly string[] = [];

export const egress = createEgress({ allowlist: EGRESS_ALLOWLIST });
