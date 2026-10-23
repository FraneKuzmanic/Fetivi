import { and, eq } from 'drizzle-orm';
import type { Executor } from '../db/client';
import {
  type OrderRow,
  orders,
  type PaymentAttemptRow,
  paymentAttempts,
} from '../db/schema/orders';

// What the guest's Pay now button gets: the stored Checkout URL while the guest can still pay,
// `preparing` while the open job has not stored it yet, `closed` otherwise. The URL never goes
// through the model; the server decides at tap time, so a stale receipt in chat is harmless.

export type CheckoutState =
  | { state: 'ready'; url: string }
  | { state: 'preparing' }
  | { state: 'closed' };

/** Whether the guest can still pay this attempt now: what `payBy` and `checkoutFor` share. */
export function checkoutOpen(
  order: Pick<OrderRow, 'paymentMode' | 'status' | 'paymentStatus' | 'currentProposalId'>,
  attempt: Pick<PaymentAttemptRow, 'proposalId' | 'sessionStatus' | 'expiresAt'> | null,
  now: Date,
): boolean {
  return (
    order.paymentMode === 'online' &&
    order.status === 'confirming' &&
    order.paymentStatus === 'none' &&
    attempt !== null &&
    attempt.proposalId === order.currentProposalId &&
    (attempt.sessionStatus === null || attempt.sessionStatus === 'open') &&
    attempt.expiresAt > now
  );
}

/** The checkout of an Order of the space; null when the Order is not the space's. */
export async function checkoutFor(
  db: Executor,
  spaceId: string,
  orderId: string,
  now: Date,
): Promise<CheckoutState | null> {
  const [row] = await db
    .select({ order: orders, attempt: paymentAttempts })
    .from(orders)
    .leftJoin(
      paymentAttempts,
      and(
        eq(paymentAttempts.orderId, orders.id),
        eq(paymentAttempts.proposalId, orders.currentProposalId),
      ),
    )
    .where(and(eq(orders.id, orderId), eq(orders.spaceId, spaceId)));
  if (!row) return null;
  if (!checkoutOpen(row.order, row.attempt, now) || !row.attempt) return { state: 'closed' };
  return row.attempt.checkoutUrl
    ? { state: 'ready', url: row.attempt.checkoutUrl }
    : { state: 'preparing' };
}
