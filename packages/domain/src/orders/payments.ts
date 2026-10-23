import { eq, sql } from 'drizzle-orm';
import type { Tx } from '../db/client';
import {
  inventoryHolds,
  type OrderRow,
  orderEvents,
  orders,
  type PaymentAttemptRow,
  paymentAttempts,
} from '../db/schema/orders';
import { enqueuePaymentJob } from '../payments/enqueue';
import type { IntentStatus, RefundStatus, SessionStatus } from '../payments/vocabulary';
import {
  type ChangeMeta,
  type OrderDeps,
  OrderRuleError,
  releaseIn,
  requestRefundIn,
  type TransitionOutcome,
  writePayment,
} from './machine';
import { enqueueNotification } from './timers';
import type { PaymentStatus } from './vocabulary';

// The payment half of the Order machine (33). Each transition is one transaction: it locks the
// Order row, then the attempt row (the lock order of the machine), records the Stripe event id
// on the attempt so an event is processed once, mirrors Stripe's state on the attempt, writes
// Payment status through the Payment-status table and enqueues the next payment job. A
// payment-only change writes one OrderEvent whose from and to Order status are the same.

export interface PaymentTransitionInput {
  attemptId: string;
  /** The Stripe event id when the change came by webhook; a repeat of it is `unchanged`. */
  eventId?: string;
  trigger: 'payment_webhook' | 'payment_job' | 'admin';
}

type Mirror = {
  sessionId?: string;
  sessionStatus?: SessionStatus;
  intentStatus?: IntentStatus;
  refundStatus?: RefundStatus;
  paymentIntentId?: string;
};

interface Locked {
  tx: Tx;
  order: OrderRow;
  attempt: PaymentAttemptRow;
  /** The attempt is for the Order's current proposal; a superseded one (36) leaves Payment status alone. */
  current: boolean;
}

/** Payment statuses an action's effect is already contained in, so a late event is `unchanged`. */
const ALREADY: Record<
  'authorize' | 'capture' | 'void' | 'refunded' | 'refund_failed',
  PaymentStatus[]
> = {
  authorize: ['authorized', 'captured', 'voided', 'refund_pending', 'refunded', 'failed'],
  capture: ['captured', 'refund_pending', 'refunded', 'failed'],
  void: ['voided'],
  refunded: ['refunded'],
  refund_failed: ['failed', 'refunded'],
};

async function withLockedAttempt(
  deps: OrderDeps,
  input: PaymentTransitionInput,
  body: (locked: Locked) => Promise<TransitionOutcome>,
): Promise<TransitionOutcome> {
  return deps.db.transaction(async (tx) => {
    const [found] = await tx
      .select({ orderId: paymentAttempts.orderId })
      .from(paymentAttempts)
      .where(eq(paymentAttempts.id, input.attemptId));
    if (!found) throw new OrderRuleError('not-found');
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, found.orderId))
      .for('update');
    if (!order) throw new OrderRuleError('not-found');
    const [attempt] = await tx
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.id, input.attemptId))
      .for('update');
    if (!attempt) throw new OrderRuleError('not-found');
    if (input.eventId) {
      if (attempt.processedEventIds.includes(input.eventId)) return { outcome: 'unchanged', order };
      // Recorded whatever the outcome: an event processed as stale is still processed.
      await tx
        .update(paymentAttempts)
        .set({
          processedEventIds: sql`array_append(${paymentAttempts.processedEventIds}, ${input.eventId})`,
        })
        .where(eq(paymentAttempts.id, attempt.id));
    }
    return body({ tx, order, attempt, current: order.currentProposalId === attempt.proposalId });
  });
}

async function mirror(
  tx: Tx,
  deps: OrderDeps,
  attempt: PaymentAttemptRow,
  set: Mirror,
): Promise<PaymentAttemptRow> {
  const [updated] = await tx
    .update(paymentAttempts)
    .set({ ...set, updatedAt: deps.now() })
    .where(eq(paymentAttempts.id, attempt.id))
    .returning();
  if (!updated) throw new OrderRuleError('not-found');
  return updated;
}

async function flagAdmin(tx: Tx, deps: OrderDeps, order: OrderRow, attempt: PaymentAttemptRow) {
  await enqueueNotification(tx, deps.queue, {
    orderId: order.id,
    proposalId: attempt.proposalId,
    kind: 'admin_payment_attention',
  });
}

/**
 * The guest completed the Checkout: the card is authorized. A `confirming` Order whose hold is
 * still held and ahead is confirmed next; any other Order (expired, failed, cancelled, or a
 * hold that already expired: a checkout completed too late) has the authorization voided.
 */
export function authorize(
  deps: OrderDeps,
  input: PaymentTransitionInput & {
    paymentIntentId: string;
    /** From a session event: learns the session when the create's response was lost. */
    sessionId?: string | null;
  },
): Promise<TransitionOutcome> {
  return withLockedAttempt(deps, input, async ({ tx, order, attempt, current }) => {
    const mirrored = await mirror(tx, deps, attempt, {
      sessionId: attempt.sessionId ?? input.sessionId ?? undefined,
      sessionStatus: 'complete',
      // An intent already captured or cancelled stays so: Stripe's state is never undone.
      intentStatus: attempt.intentStatus ?? 'requires_capture',
      paymentIntentId: input.paymentIntentId,
    });
    if (!current) {
      if (mirrored.intentStatus === 'requires_capture') {
        await enqueuePaymentJob(tx, deps.queue, mirrored, 'void');
      }
      return { outcome: 'stale', order };
    }
    if (ALREADY.authorize.includes(order.paymentStatus)) return { outcome: 'unchanged', order };
    const result = await writePayment(tx, deps, order, attempt.proposalId, 'authorize', input);
    if (result.outcome !== 'applied') return result;
    const [hold] = await tx
      .select()
      .from(inventoryHolds)
      .where(eq(inventoryHolds.proposalId, attempt.proposalId));
    const confirmable =
      order.status === 'confirming' && hold?.state === 'held' && hold.expiresAt > deps.now();
    await enqueuePaymentJob(tx, deps.queue, mirrored, confirmable ? 'confirm' : 'void');
    return result;
  });
}

/**
 * The intent was captured. A capture that won a race against a release (the Order is not
 * confirmed at this instant) is refunded at once.
 */
export function recordCaptured(
  deps: OrderDeps,
  input: PaymentTransitionInput,
): Promise<TransitionOutcome> {
  return withLockedAttempt(deps, input, async ({ tx, order, attempt, current }) => {
    const mirrored = await mirror(tx, deps, attempt, { intentStatus: 'succeeded' });
    if (!current) {
      if (mirrored.refundStatus === null) {
        await mirror(tx, deps, mirrored, { refundStatus: 'pending' });
        await enqueuePaymentJob(tx, deps.queue, mirrored, 'refund');
      }
      return { outcome: 'stale', order };
    }
    if (ALREADY.capture.includes(order.paymentStatus)) return { outcome: 'unchanged', order };
    const result = await writePayment(tx, deps, order, attempt.proposalId, 'capture', input);
    if (result.outcome !== 'applied') return result;
    if (result.order.status === 'confirmed' || result.order.status === 'completed') return result;
    const refund = await requestRefundIn(tx, deps, result.order, mirrored, {
      ...input,
      note: 'captured after the Order was released',
    });
    return { outcome: 'applied', order: refund.order };
  });
}

/**
 * The authorization was cancelled. On a confirmed Order that is money the Provider will not get,
 * so the admin is flagged (the lapse path is closed by 34).
 */
export function recordVoided(
  deps: OrderDeps,
  input: PaymentTransitionInput,
): Promise<TransitionOutcome> {
  return withLockedAttempt(deps, input, async ({ tx, order, attempt, current }) => {
    await mirror(tx, deps, attempt, { intentStatus: 'canceled' });
    if (!current) return { outcome: 'stale', order };
    if (ALREADY.void.includes(order.paymentStatus)) return { outcome: 'unchanged', order };
    const confirmed = order.status === 'confirmed';
    const meta: ChangeMeta = confirmed
      ? { ...input, note: 'authorization cancelled on a confirmed Order' }
      : input;
    const result = await writePayment(tx, deps, order, attempt.proposalId, 'void', meta);
    if (result.outcome === 'applied' && confirmed) await flagAdmin(tx, deps, order, attempt);
    return result;
  });
}

/** Captured money goes back in full: Payment `captured → refund_pending` and the refund job. */
export function requestRefund(
  deps: OrderDeps,
  input: PaymentTransitionInput & { actorId?: string; note?: string },
): Promise<TransitionOutcome> {
  return withLockedAttempt(deps, input, async ({ tx, order, attempt, current }) => {
    if (!current) return { outcome: 'stale', order };
    return requestRefundIn(tx, deps, order, attempt, input);
  });
}

/** The refund succeeded. */
export function recordRefunded(
  deps: OrderDeps,
  input: PaymentTransitionInput,
): Promise<TransitionOutcome> {
  return withLockedAttempt(deps, input, async ({ tx, order, attempt, current }) => {
    await mirror(tx, deps, attempt, { refundStatus: 'succeeded' });
    if (!current) return { outcome: 'stale', order };
    if (ALREADY.refunded.includes(order.paymentStatus)) return { outcome: 'unchanged', order };
    return writePayment(tx, deps, order, attempt.proposalId, 'refunded', input);
  });
}

/** The refund failed: Payment `failed`, and the admin is flagged. */
export function recordRefundFailed(
  deps: OrderDeps,
  input: PaymentTransitionInput,
): Promise<TransitionOutcome> {
  return withLockedAttempt(deps, input, async ({ tx, order, attempt, current }) => {
    await mirror(tx, deps, attempt, { refundStatus: 'failed' });
    if (!current) return { outcome: 'stale', order };
    if (ALREADY.refund_failed.includes(order.paymentStatus)) {
      return { outcome: 'unchanged', order };
    }
    const result = await writePayment(tx, deps, order, attempt.proposalId, 'refund_failed', {
      ...input,
      note: 'refund failed',
    });
    if (result.outcome === 'applied') await flagAdmin(tx, deps, order, attempt);
    return result;
  });
}

/**
 * The Checkout Session expired unpaid. A `confirming` Order with nothing authorized expires with
 * it and releases its hold; the hold timer does the same at the same instant, so whichever comes
 * second is `unchanged`.
 */
export function sessionExpired(
  deps: OrderDeps,
  input: PaymentTransitionInput & { sessionId?: string | null },
): Promise<TransitionOutcome> {
  return withLockedAttempt(deps, input, async ({ tx, order, attempt, current }) => {
    if (attempt.sessionStatus !== 'complete') {
      await mirror(tx, deps, attempt, {
        sessionId: attempt.sessionId ?? input.sessionId ?? undefined,
        sessionStatus: 'expired',
      });
    }
    if (!current) return { outcome: 'stale', order };
    if (order.status !== 'confirming' || order.paymentStatus !== 'none') {
      return { outcome: 'unchanged', order };
    }
    return releaseIn(tx, deps, order, 'expire', {
      orderId: order.id,
      proposalId: attempt.proposalId,
      trigger: input.trigger === 'payment_webhook' ? 'payment_webhook' : 'payment_job',
    });
  });
}

/**
 * The checkout cannot be offered (a non-card method on the created session, or Stripe rejected
 * the create for good): the Order fails, its hold is released and the admin is flagged.
 */
export function failCheckout(
  deps: OrderDeps,
  input: { attemptId: string; reason: string },
): Promise<TransitionOutcome> {
  return withLockedAttempt(
    deps,
    { attemptId: input.attemptId, trigger: 'payment_job' },
    async ({ tx, order, attempt, current }) => {
      if (!current) return { outcome: 'stale', order };
      const result = await releaseIn(tx, deps, order, 'fail', {
        orderId: order.id,
        proposalId: attempt.proposalId,
        trigger: 'payment_job',
        note: input.reason,
      });
      if (result.outcome === 'applied') await flagAdmin(tx, deps, order, attempt);
      return result;
    },
  );
}

/**
 * A payment call failed for good with no Payment change to record (Stripe rejected a capture,
 * a cancel or a refund): one OrderEvent carries the reason and the admin is flagged.
 */
export function flagPaymentAttention(
  deps: OrderDeps,
  input: { attemptId: string; reason: string },
): Promise<TransitionOutcome> {
  return withLockedAttempt(
    deps,
    { attemptId: input.attemptId, trigger: 'payment_job' },
    async ({ tx, order, attempt }) => {
      await tx.insert(orderEvents).values({
        orderId: order.id,
        proposalId: attempt.proposalId,
        fromStatus: order.status,
        toStatus: order.status,
        fromPaymentStatus: order.paymentStatus,
        toPaymentStatus: order.paymentStatus,
        trigger: 'payment_job',
        note: input.reason,
        createdAt: deps.now(),
      });
      await flagAdmin(tx, deps, order, attempt);
      return { outcome: 'applied', order };
    },
  );
}
