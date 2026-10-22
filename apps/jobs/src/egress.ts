import { CALENDAR_HOSTS } from '@fetivi/domain/calendar-vocabulary';
import { createEgress } from '@fetivi/egress';

// Hosts this process may call. Later tickets add entries.
export const EGRESS_ALLOWLIST: readonly string[] = ['api.anthropic.com', ...CALENDAR_HOSTS];

export const egress = createEgress({ allowlist: EGRESS_ALLOWLIST });
