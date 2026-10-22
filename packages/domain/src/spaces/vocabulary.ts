// Space cookies and PIN entry limits. Imports nothing.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Holds one Space token on the guest app's origin. */
export const SPACE_COOKIE = '__Host-fetivi_space';
/** A random device id; the per-device PIN limit counts against it. */
export const DEVICE_COOKIE = '__Host-fetivi_device';

/** The space cookie lives until `closed_at` plus this many days (the read-only period). */
export const SPACE_READ_ONLY_DAYS = 30;

export const SPACE_READ_ONLY_MS = SPACE_READ_ONLY_DAYS * DAY;

/** The end of the read-only period: the cookie, recovery mails and restores all stop here. */
export const readOnlyEndsAt = (closedAt: Date): Date =>
  new Date(closedAt.getTime() + SPACE_READ_ONLY_MS);

/**
 * Failures-only PIN limits. Per key: `free` failures in the window are not delayed; after that
 * each attempt waits `base * 2^(failures - free)` from the latest failure, capped at `cap`.
 */
export const PIN_LIMITS = {
  device: { windowMs: HOUR, free: 5, baseMs: 30_000, capMs: 15 * MINUTE },
  ip: { windowMs: DAY, free: 30, baseMs: MINUTE, capMs: 15 * MINUTE },
  /** Failures on one property in the last hour that switch it to slow mode. */
  property: { windowMs: HOUR, slowAt: 50 },
  /** In slow mode every key's first failure already counts, and the IP cap rises. */
  slow: { free: 1, ipCapMs: 60 * MINUTE },
  /** pin_attempts rows older than this are deleted. */
  keepMs: DAY,
} as const;

/** What an emailed Space link does. */
export const SPACE_TOKEN_PURPOSES = ['verify_email', 'recover'] as const;
export type SpaceTokenPurpose = (typeof SPACE_TOKEN_PURPOSES)[number];

/** A verification link works for a day. */
export const SPACE_VERIFY_TTL_MS = DAY;
/** A recovery link is short-lived: it opens the Space on any device. */
export const SPACE_RECOVERY_TTL_MS = HOUR;
/** Mails per Space and purpose in an hour; more requests are dropped silently. */
export const SPACE_EMAILS_PER_HOUR = 3;

/** The guest app page each link opens. */
export const SPACE_EMAIL_PATHS = {
  verify_email: '/verify-email',
  recover: '/recover',
} as const satisfies Record<SpaceTokenPurpose, string>;
