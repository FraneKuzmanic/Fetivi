import { eq } from 'drizzle-orm';
import { orders, paymentAttempts } from '../db/schema/orders';
import type { AvailabilityMode } from '../offers/vocabulary';
import { adapterFor } from '../services/adapters';
import type { ProviderAdapter } from '../services/adapters/interface';
import {
  cancel,
  getOrder,
  lockAttempt,
  type OrderDeps,
  OrderRuleError,
  requestRefundIn,
  type TransitionOutcome,
} from './machine';
import type { OrderAdapterCancelJobData } from './timers';

// The admin's cancel and refund (35), and the live engine's cancel job. Every write goes through
// the machine; the admin's actor and note land on the OrderEvent.

function withNote(prefix: string, note: string | undefined): string {
  return note ? `${prefix}; ${note}` : prefix;
}

/** Cents as the amount the admin typed: 3000 reads 30.00. */
const major = (minor: number) => (minor / 100).toFixed(2);

/**
 * Admin cancel: full refund unless `refundMinor` overrides it. Trigger admin, actor and note
 * recorded. Only captured money can be refunded in part; an authorization is voided in full.
 */
export async function adminCancel(
  deps: OrderDeps,
  input: { orderId: string; actorId: string; refundMinor?: number; note?: string },
): Promise<TransitionOutcome> {
  const found = await getOrder(deps.db, input.orderId);
  if (!found) throw new OrderRuleError('not-found');
  const { order, proposal } = found;
  let note = input.note;
  if (input.refundMinor !== undefined) {
    if (order.paymentStatus !== 'captured') throw new OrderRuleError('invalid-input');
    // A first bound check for a clear error; the machine checks again under its locks.
    const [attempt] = await deps.db
      .select({ amountMinor: paymentAttempts.amountMinor })
      .from(paymentAttempts)
      .where(eq(paymentAttempts.proposalId, proposal.id));
    const amount = attempt?.amountMinor;
    const valid =
      amount !== undefined &&
      Number.isInteger(input.refundMinor) &&
      input.refundMinor >= 0 &&
      input.refundMinor <= amount;
    if (!valid) throw new OrderRuleError('invalid-input');
    note = withNote(
      `refund override: ${major(input.refundMinor)} of ${major(amount)} ${order.currency}`,
      input.note,
    );
  }
  return cancel(deps, {
    orderId: order.id,
    proposalId: proposal.id,
    trigger: 'admin',
    actorId: input.actorId,
    refundMinor: input.refundMinor,
    note,
  });
}

/**
 * Admin refund of a cancelled or completed Order whose Payment is still `captured` (a 0 % policy
 * cancel, a completed dispute). One refund per attempt: an attempt that already refunded is
 * `rejected`, and anything more is done in the Provider's Stripe dashboard.
 */
export async function adminRefund(
  deps: OrderDeps,
  input: { orderId: string; actorId: string; refundMinor: number; note?: string },
): Promise<TransitionOutcome> {
  if (!Number.isInteger(input.refundMinor) || input.refundMinor < 1) {
    throw new OrderRuleError('invalid-input');
  }
  return deps.db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, input.orderId))
      .for('update');
    if (!order) throw new OrderRuleError('not-found');
    const released = order.status === 'cancelled' || order.status === 'completed';
    if (!released || order.paymentStatus !== 'captured' || !order.currentProposalId) {
      return { outcome: 'rejected', order };
    }
    const attempt = await lockAttempt(tx, order.currentProposalId);
    if (!attempt || (attempt.refundAmountMinor !== null && attempt.refundAmountMinor !== 0)) {
      return { outcome: 'rejected', order };
    }
    const note = withNote(
      `admin refund: ${major(input.refundMinor)} of ${major(attempt.amountMinor)} ${attempt.currency}`,
      input.note,
    );
    return requestRefundIn(
      tx,
      deps,
      order,
      attempt,
      { trigger: 'admin', actorId: input.actorId, note },
      input.refundMinor,
    );
  });
}

/**
 * The order-adapter-cancel job: the Provider system's cancel, outside any transaction.
 * Idempotent per the adapter contract; an error propagates so pg-boss retries.
 */
export async function runAdapterCancel(
  deps: OrderDeps,
  data: OrderAdapterCancelJobData,
  adapters: (mode: AvailabilityMode) => ProviderAdapter = adapterFor,
): Promise<'applied' | 'stale'> {
  const [order] = await deps.db.select().from(orders).where(eq(orders.id, data.orderId));
  if (order?.status !== 'cancelled') return 'stale';
  await adapters(order.availabilityMode).cancel(
    { db: deps.db, now: deps.now },
    { orderId: data.orderId, proposalId: data.proposalId },
  );
  return 'applied';
}
