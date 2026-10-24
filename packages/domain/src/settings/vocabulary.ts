// The admin's platform-wide settings. Imports nothing.

/** Guest chat messages per Space per property day when the admin has set nothing. */
export const DEFAULT_DAILY_MESSAGE_CAP = 60;
export const MESSAGE_CAP_LIMITS = { min: 1, max: 1000 } as const;
