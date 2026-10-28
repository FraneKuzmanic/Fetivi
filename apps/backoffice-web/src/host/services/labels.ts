// The host's own services (38) offer two availability modes; their words are in the `labels`
// namespace (hostAvailability, hostPayment): the host is the one who accepts and gets paid.

export const HOST_AVAILABILITY_MODES = ['on_request', 'allotment'] as const;
export type HostAvailabilityMode = (typeof HOST_AVAILABILITY_MODES)[number];
