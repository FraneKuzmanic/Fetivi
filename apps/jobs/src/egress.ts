import { JADROLINIJA_HOST } from '@fetivi/domain/alerts-vocabulary';
import { CALENDAR_HOSTS } from '@fetivi/domain/calendar-vocabulary';
import { HOST_PUSH_HOSTS } from '@fetivi/domain/host-notification-vocabulary';
import { PUSH_HOSTS } from '@fetivi/domain/notification-vocabulary';
import { SEEDING_HOSTS } from '@fetivi/domain/seeding-vocabulary';
import { createEgress } from '@fetivi/egress';

// Hosts this process may call, with the Jadrolinija feed off. Later tickets add entries.
export const EGRESS_ALLOWLIST: readonly string[] = [
  'api.anthropic.com',
  ...CALENDAR_HOSTS,
  'api.resend.com',
  // Guest and host push services; hosts add Apple's for iPhone Home Screen apps.
  ...new Set([...PUSH_HOSTS, ...HOST_PUSH_HOSTS]),
  // DHMZ weather warnings, for safety alerts.
  'meteo.hr',
  // Stripe, for pay-online checkout, capture, void and refund.
  'api.stripe.com',
  // Open-data seeding sources (41).
  ...SEEDING_HOSTS,
];

/** The allowlist; Jadrolinija's host joins only when its feed is on (written permission). */
export function jobsEgressAllowlist({ jadrolinija }: { jadrolinija: boolean }): readonly string[] {
  return jadrolinija ? [...EGRESS_ALLOWLIST, JADROLINIJA_HOST] : EGRESS_ALLOWLIST;
}

export function createJobsEgress(options: { jadrolinija: boolean }) {
  return createEgress({ allowlist: jobsEgressAllowlist(options) });
}
