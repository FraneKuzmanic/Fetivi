import { GEOCODER_HOSTS } from '@fetivi/domain';
import { LLM_PROVIDER_HOSTS } from '@fetivi/domain/settings-vocabulary';
import { createEgress } from '@fetivi/egress';

// Hosts this process may call. Later tickets add entries.
export const EGRESS_ALLOWLIST: readonly string[] = [
  // The language model providers the admin can choose (71).
  ...Object.values(LLM_PROVIDER_HOSTS),
  'api.resend.com',
  // Stripe, for Provider payment onboarding.
  'api.stripe.com',
  // Address search on the host's property form.
  ...GEOCODER_HOSTS,
];

export const egress = createEgress({ allowlist: EGRESS_ALLOWLIST });
