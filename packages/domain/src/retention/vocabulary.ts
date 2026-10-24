// The retention rule: what the daily job deletes and what it keeps. Imports nothing.

/** Daily 02:30 UTC, after the night's Stays end in Europe. */
export const RETENTION_CRON = '30 2 * * *';
/** The Order ledger is kept this many years after the Space closed (commission accounting). */
export const LEDGER_KEEP_YEARS = 11;
/** Spaces per query page; the run loops until none are due. */
export const RETENTION_BATCH = 100;
/** Payment statuses Stripe will not act on again; anything else holds the Space back. */
export const SETTLED_PAYMENT_STATUSES = [
  'none',
  'captured',
  'voided',
  'refunded',
  'failed',
] as const;
