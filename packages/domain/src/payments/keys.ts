import { CARD_METHODS, type StripeKeyOperation } from './vocabulary';

/**
 * The idempotency key of one Stripe call of an attempt. It carries the stored `expires_at`, so a
 * restamped attempt never collides with its earlier keys, and a retry sends the same key.
 */
export function stripeIdempotencyKey(
  attempt: { orderId: string; proposalVersion: number; expiresAt: Date },
  operation: StripeKeyOperation,
): string {
  const expires = Math.floor(attempt.expiresAt.getTime() / 1000);
  return `order:${attempt.orderId}:proposal:${attempt.proposalVersion}:${operation}:${expires}`;
}

/** Fetivi's commission in minor units, rounded down: never more than the deal. */
export function applicationFee(amountMinor: number, commissionBp: number): number {
  return Math.floor((amountMinor * commissionBp) / 10_000);
}

/** Whether a created session offers cards (and Link, which cannot be excluded) only. */
export function assertCardOnly(methods: readonly string[]): boolean {
  const allowed: readonly string[] = CARD_METHODS;
  return methods.includes('card') && methods.every((m) => allowed.includes(m));
}
