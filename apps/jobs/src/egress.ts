import { CALENDAR_HOSTS } from '@fetivi/domain/calendar-vocabulary';
import { HOST_PUSH_HOSTS } from '@fetivi/domain/host-notification-vocabulary';
import { PUSH_HOSTS } from '@fetivi/domain/notification-vocabulary';
import { createEgress } from '@fetivi/egress';

// Hosts this process may call. Later tickets add entries.
export const EGRESS_ALLOWLIST: readonly string[] = [
  'api.anthropic.com',
  ...CALENDAR_HOSTS,
  'api.resend.com',
  // Guest and host push services; hosts add Apple's for iPhone Home Screen apps.
  ...new Set([...PUSH_HOSTS, ...HOST_PUSH_HOSTS]),
];

export const egress = createEgress({ allowlist: EGRESS_ALLOWLIST });
