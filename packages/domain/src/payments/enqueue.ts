import type { Executor } from '../db/client';
import type { PaymentAttemptRow } from '../db/schema/orders';
import { type JobQueue, QUEUES } from '../jobs/queue';
import { orderJobId } from '../orders/timers';
import type { PaymentOperation } from './vocabulary';

// Enqueues order-payment jobs from inside the machine's transaction. Kept apart from the Stripe
// gateway so the machine never imports the SDK.

/** Ids and operation only. */
export interface OrderPaymentJobData {
  attemptId: string;
  operation: PaymentOperation;
}

/**
 * Enqueues one payment operation of an attempt, once per Order, proposal and operation. `open`
 * also names the stored expiry, so a restamped attempt gets a fresh job.
 */
export async function enqueuePaymentJob(
  tx: Executor,
  queue: JobQueue,
  attempt: Pick<PaymentAttemptRow, 'id' | 'orderId' | 'proposalId' | 'expiresAt'>,
  operation: PaymentOperation,
): Promise<void> {
  const suffix = operation === 'open' ? `:${Math.floor(attempt.expiresAt.getTime() / 1000)}` : '';
  const id = orderJobId(attempt.orderId, attempt.proposalId, `payment:${operation}${suffix}`);
  const data: OrderPaymentJobData = { attemptId: attempt.id, operation };
  await queue.send(QUEUES.orderPayment, data, tx, { id });
}
