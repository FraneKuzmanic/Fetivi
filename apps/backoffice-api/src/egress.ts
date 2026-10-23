import { createEgress } from '@fetivi/egress';

// Hosts this process may call. Later tickets add entries.
export const EGRESS_ALLOWLIST: readonly string[] = [
  'api.anthropic.com',
  'api.resend.com',
  // Stripe, for Provider payment onboarding.
  'api.stripe.com',
];

export const egress = createEgress({ allowlist: EGRESS_ALLOWLIST });
