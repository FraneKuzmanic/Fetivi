import { GEOCODER_HOSTS } from '@fetivi/domain';
import { createEgress } from '@fetivi/egress';

// Hosts this process may call. Later tickets add entries.
export const EGRESS_ALLOWLIST: readonly string[] = [
  'api.anthropic.com',
  'api.resend.com',
  // Stripe, for Provider payment onboarding.
  'api.stripe.com',
  // Address search on the host's property form.
  ...GEOCODER_HOSTS,
];

export const egress = createEgress({ allowlist: EGRESS_ALLOWLIST });
