import type { PaymentMode } from '@fetivi/domain/offer-vocabulary';

// The host's words for their own services (38): the host is the one who accepts and gets paid,
// so the admin labels that name "the Provider" don't fit.

export const HOST_AVAILABILITY_MODES = ['on_request', 'allotment'] as const;
export type HostAvailabilityMode = (typeof HOST_AVAILABILITY_MODES)[number];

export const HOST_AVAILABILITY_LABELS: Record<HostAvailabilityMode, string> = {
  on_request: 'On request (you accept each order)',
  allotment: 'Fixed times (seats you set)',
};

export const HOST_AVAILABILITY_SHORT: Record<HostAvailabilityMode, string> = {
  on_request: 'On request',
  allotment: 'Fixed times',
};

export const HOST_PAYMENT_LABELS: Record<PaymentMode, string> = {
  direct: 'The guest pays you directly',
  online: 'Online, into your Stripe account',
};
