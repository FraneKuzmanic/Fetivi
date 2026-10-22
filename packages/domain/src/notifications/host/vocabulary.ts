// Host notifications' controlled lists (PRD §6.6 Host). Imports nothing, so the pgEnums are built
// from it and the back office can read it without the domain.

/** Immediate: one notification per Host message. Digest: bundled at the host's chosen times. */
export const HOST_DELIVERY_MODES = ['immediate', 'digest'] as const;
export type HostDeliveryMode = (typeof HOST_DELIVERY_MODES)[number];

/** Email always; push when the host set it up. No SMS or WhatsApp (PRD §6.6). */
export const HOST_CHANNELS = ['email', 'push'] as const;
export type HostChannel = (typeof HOST_CHANNELS)[number];

/** Nothing waits unless the host chooses Digest. */
export const DEFAULT_HOST_DELIVERY_MODE: HostDeliveryMode = 'immediate';

/** Wall-clock times in the host's property timezone (PRD §6.6). */
export const DEFAULT_DIGEST_TIMES = ['09:00', '14:00', '19:00'] as const;

export const DIGEST_LIMITS = { minTimes: 1, maxTimes: 6 } as const;

/** `HH:MM`, 24-hour, zero-padded. */
export const DIGEST_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** How often the digest scan runs; a digest is at most this late. */
export const HOST_DIGESTS_CRON = '*/5 * * * *';

/** The `properties.timezone` default, used when the host has no property yet. */
export const DEFAULT_HOST_TIMEZONE = 'Europe/Zagreb';

/** Push services a host subscription may point at. iPhone hosts use Apple's; guest push stays Android-only. */
export const HOST_PUSH_HOSTS = [
  'fcm.googleapis.com',
  '*.push.services.mozilla.com',
  'web.push.apple.com',
] as const;

/** Where host emails and pushes link to. */
export const HOST_INBOX_PATH = '/inbox';
