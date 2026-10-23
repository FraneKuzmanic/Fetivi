import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Tx } from '../db/client';
import {
  inventoryHolds,
  type OrderRow,
  orders,
  type PaymentAttemptRow,
  paymentAttempts,
} from '../db/schema/orders';
import { type OrderDeps, OrderRuleError } from '../orders/machine';
import {
  authorize,
  failCheckout,
  flagPaymentAttention,
  recordCaptured,
  recordRefunded,
  recordRefundFailed,
  recordVoided,
  sessionExpired,
} from '../orders/payments';
import { scheduleTimer } from '../orders/timers';
import { confirmHeldOrder } from '../services/adapters';
import { enqueuePaymentJob, type OrderPaymentJobData } from './enqueue';
import {
  type CheckoutParams,
  type CheckoutSessionView,
  type PaymentGateway,
  PaymentGatewayError,
  type WriteOptions,
} from './gateway';
import { isCardOnly, stripeIdempotencyKey } from './keys';
import {
  CHECKOUT_HOLD_MINUTES,
  CHECKOUT_MIN_LEAD_SECONDS,
  type PaymentOperation,
  type StripeKeyOperation,
} from './vocabulary';

// The order-payment job: every Stripe write of a pay-online Order. Each operation reads the
// attempt, calls Stripe outside any transaction under the attempt's idempotency key (every
// parameter comes from stored attempt columns, so a retry sends the same request), and writes
// the outcome back through the machine, where a repeat is `unchanged` or `stale`. A connection
// failure throws, so pg-boss retries the same request.

export interface PaymentDeps extends OrderDeps {
  gateway: PaymentGateway;
  /** The guest app's origin, for the Checkout return URLs; the same on every retry. */
  guestOrigin: string;
}

export type PaymentJobOutcome =
  | 'applied'
  | 'unchanged'
  | 'stale'
  | 'rejected'
  | 'restamped'
  | 'waiting';

export interface PaymentJobResult {
  operation: PaymentOperation;
  outcome: PaymentJobOutcome;
}

async function load(deps: OrderDeps, attemptId: string) {
  const [row] = await deps.db
    .select({ attempt: paymentAttempts, order: orders })
    .from(paymentAttempts)
    .innerJoin(orders, eq(orders.id, paymentAttempts.orderId))
    .where(eq(paymentAttempts.id, attemptId));
  if (!row) throw new OrderRuleError('not-found');
  return { ...row, current: row.order.currentProposalId === row.attempt.proposalId };
}

const keyed = (attempt: PaymentAttemptRow, op: StripeKeyOperation): WriteOptions => ({
  stripeAccount: attempt.stripeAccountId,
  idempotencyKey: stripeIdempotencyKey(attempt, op),
});

/** The create parameters, all from stored columns: a replay sends the identical request. */
function checkoutParams(attempt: PaymentAttemptRow, guestOrigin: string): CheckoutParams {
  return {
    clientReferenceId: attempt.id,
    expiresAt: attempt.expiresAt,
    amountMinor: attempt.amountMinor,
    currency: attempt.currency,
    productName: attempt.productName,
    locale: attempt.locale,
    successUrl: `${guestOrigin}/trip?checkout=${attempt.orderId}`,
    cancelUrl: `${guestOrigin}/trip?order=${attempt.orderId}`,
    metadata: { fetivi_attempt_id: attempt.id, fetivi_order_id: attempt.orderId },
  };
}

const awaitingPayment = (order: OrderRow, current: boolean) =>
  current && order.status === 'confirming' && order.paymentStatus === 'none';

/** Connection trouble: pg-boss retries the same request. Anything else is the caller's to map. */
function rethrowUnavailable(error: unknown): asserts error is PaymentGatewayError {
  if (!(error instanceof PaymentGatewayError) || error.code === 'unavailable') throw error;
}

/** Locks the Order, then the attempt, and runs `body` in one transaction. */
function withLocked<T>(
  deps: OrderDeps,
  attemptId: string,
  body: (tx: Tx, order: OrderRow, attempt: PaymentAttemptRow) => Promise<T>,
): Promise<T> {
  return deps.db.transaction(async (tx) => {
    const [found] = await tx
      .select({ orderId: paymentAttempts.orderId })
      .from(paymentAttempts)
      .where(eq(paymentAttempts.id, attemptId));
    if (!found) throw new OrderRuleError('not-found');
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, found.orderId))
      .for('update');
    const [attempt] = await tx
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.id, attemptId))
      .for('update');
    if (!order || !attempt) throw new OrderRuleError('not-found');
    return body(tx, order, attempt);
  });
}

/**
 * Moves an attempt whose create was never accepted to a fresh 30-minute window: the attempt and
 * its inventory hold get the same new expiry, a hold timer keyed with it (the old one is stale
 * at its time), and a new `open` job. Inside the caller's Order lock.
 */
async function restampIn(tx: Tx, deps: OrderDeps, attempt: PaymentAttemptRow): Promise<boolean> {
  const [hold] = await tx
    .select()
    .from(inventoryHolds)
    .where(eq(inventoryHolds.proposalId, attempt.proposalId));
  if (hold?.state !== 'held') return false;
  const now = deps.now();
  const expiresAt = new Date(now.getTime() + CHECKOUT_HOLD_MINUTES * 60_000);
  const [restamped] = await tx
    .update(paymentAttempts)
    .set({ expiresAt, createSentAt: null, updatedAt: now })
    .where(eq(paymentAttempts.id, attempt.id))
    .returning();
  if (!restamped) throw new OrderRuleError('not-found');
  await tx.update(inventoryHolds).set({ expiresAt }).where(eq(inventoryHolds.id, hold.id));
  await scheduleTimer(
    tx,
    deps.queue,
    { orderId: attempt.orderId, proposalId: attempt.proposalId, operation: 'hold_expiry' },
    expiresAt,
    String(Math.floor(expiresAt.getTime() / 1000)),
  );
  await enqueuePaymentJob(tx, deps.queue, restamped, 'open');
  return true;
}

/** Records the created session's id (and its URL when it may be offered), where not yet set. */
async function recordSession(
  deps: OrderDeps,
  attempt: PaymentAttemptRow,
  session: CheckoutSessionView,
  offerable: boolean,
) {
  await deps.db
    .update(paymentAttempts)
    .set({
      sessionId: session.id,
      checkoutUrl: offerable ? session.url : null,
      sessionStatus: sql`coalesce(${paymentAttempts.sessionStatus}, 'open')`,
      updatedAt: deps.now(),
    })
    .where(and(eq(paymentAttempts.id, attempt.id), isNull(paymentAttempts.sessionId)));
}

async function open(deps: PaymentDeps, attemptId: string): Promise<PaymentJobOutcome> {
  // Mark the create as sent under the Order lock, re-checking the Order: a release that commits
  // first sees no create to undo; one that commits after sees `createSentAt` and expires the
  // session (machine `afterRelease`).
  const ready = await withLocked(deps, attemptId, async (tx, order, attempt) => {
    if (!awaitingPayment(order, order.currentProposalId === attempt.proposalId)) {
      if (attempt.createSentAt) await enqueuePaymentJob(tx, deps.queue, attempt, 'expire_session');
      return 'stale' as const;
    }
    if (attempt.createSentAt) return attempt;
    const lead = attempt.expiresAt.getTime() - deps.now().getTime();
    if (lead < CHECKOUT_MIN_LEAD_SECONDS * 1000) {
      return (await restampIn(tx, deps, attempt)) ? ('restamped' as const) : ('stale' as const);
    }
    const [sent] = await tx
      .update(paymentAttempts)
      .set({ createSentAt: deps.now(), updatedAt: deps.now() })
      .where(eq(paymentAttempts.id, attempt.id))
      .returning();
    if (!sent) throw new OrderRuleError('not-found');
    return sent;
  });
  if (typeof ready === 'string') return ready;
  const attempt = ready;

  let session: CheckoutSessionView;
  try {
    session = await deps.gateway.createCheckoutSession(
      checkoutParams(attempt, deps.guestOrigin),
      keyed(attempt, 'create_session'),
    );
  } catch (error) {
    rethrowUnavailable(error);
    if (error.code === 'expires-at-invalid') {
      // Stripe never accepted the first create (the replay is rejected), so no session exists.
      const restamped = await withLocked(deps, attempt.id, (tx, order, locked) =>
        awaitingPayment(order, order.currentProposalId === locked.proposalId) &&
        locked.expiresAt.getTime() === attempt.expiresAt.getTime()
          ? restampIn(tx, deps, locked)
          : Promise.resolve(false),
      );
      return restamped ? 'restamped' : 'stale';
    }
    if (error.code === 'idempotency-mismatch') throw error;
    return (
      await failCheckout(deps, {
        attemptId: attempt.id,
        reason: `checkout create rejected (${error.detail ?? error.code})`,
      })
    ).outcome;
  }

  const cardOnly = isCardOnly(session.paymentMethodTypes);
  await recordSession(deps, attempt, session, cardOnly);
  if (!cardOnly) {
    // The machine's release enqueues `expire_session`, which closes the session at Stripe.
    return (
      await failCheckout(deps, {
        attemptId: attempt.id,
        reason: `non-card method on the checkout (${session.paymentMethodTypes.join(', ')})`,
      })
    ).outcome;
  }
  return 'applied';
}

async function confirmJob(deps: PaymentDeps, attemptId: string): Promise<PaymentJobOutcome> {
  const { attempt, order, current } = await load(deps, attemptId);
  if (!current || order.status !== 'confirming' || order.paymentStatus !== 'authorized') {
    return 'stale';
  }
  // A hold that is gone is `stale`: the hold timer's expiry already enqueued the void.
  return (await confirmHeldOrder(deps, { orderId: order.id, proposalId: attempt.proposalId }))
    .outcome;
}

async function capture(deps: PaymentDeps, attemptId: string): Promise<PaymentJobOutcome> {
  const { attempt, order, current } = await load(deps, attemptId);
  // Capture only for the proposal confirmed at this instant: a release that won has its own void.
  if (
    !current ||
    order.status !== 'confirmed' ||
    order.paymentStatus !== 'authorized' ||
    attempt.intentStatus !== 'requires_capture' ||
    !attempt.paymentIntentId
  ) {
    return 'stale';
  }
  const input = { attemptId, trigger: 'payment_job' } as const;
  try {
    await deps.gateway.capturePaymentIntent(
      attempt.paymentIntentId,
      { applicationFeeAmount: attempt.applicationFeeMinor },
      keyed(attempt, 'capture'),
    );
  } catch (error) {
    rethrowUnavailable(error);
    if (error.code === 'intent-already-captured')
      return (await recordCaptured(deps, input)).outcome;
    if (error.code === 'intent-canceled') return (await recordVoided(deps, input)).outcome;
    await flagPaymentAttention(deps, {
      attemptId,
      reason: `capture failed (${error.detail ?? error.code})`,
    });
    return 'rejected';
  }
  return (await recordCaptured(deps, input)).outcome;
}

async function voidJob(deps: PaymentDeps, attemptId: string): Promise<PaymentJobOutcome> {
  const { attempt, order, current } = await load(deps, attemptId);
  const input = { attemptId, trigger: 'payment_job' } as const;
  if (current && (order.status === 'confirmed' || order.status === 'completed')) return 'stale';
  if (attempt.intentStatus === 'succeeded') return (await recordCaptured(deps, input)).outcome;
  if (attempt.intentStatus === 'canceled') return (await recordVoided(deps, input)).outcome;
  if (!attempt.paymentIntentId) return 'stale';
  try {
    await deps.gateway.cancelPaymentIntent(attempt.paymentIntentId, keyed(attempt, 'cancel'));
  } catch (error) {
    rethrowUnavailable(error);
    // A capture won the race: the money is refunded (recordCaptured on a released Order).
    if (error.code === 'intent-already-captured') {
      return (await recordCaptured(deps, input)).outcome;
    }
    if (error.code === 'intent-canceled') return (await recordVoided(deps, input)).outcome;
    await flagPaymentAttention(deps, {
      attemptId,
      reason: `void failed (${error.detail ?? error.code})`,
    });
    return 'rejected';
  }
  return (await recordVoided(deps, input)).outcome;
}

async function expireSession(deps: PaymentDeps, attemptId: string): Promise<PaymentJobOutcome> {
  const { attempt, order, current } = await load(deps, attemptId);
  // A checkout the guest may still pay is never closed from here.
  if (awaitingPayment(order, current)) return 'stale';
  if (attempt.sessionStatus === 'expired' || attempt.sessionStatus === 'complete') return 'stale';
  const input = { attemptId, trigger: 'payment_job' } as const;
  let sessionId = attempt.sessionId;
  if (!sessionId) {
    if (!attempt.createSentAt) return 'stale';
    // The create's response was lost: replay it under the same key to learn the session
    // (Stripe replays the stored response even with a stale `expires_at`).
    try {
      const session = await deps.gateway.createCheckoutSession(
        checkoutParams(attempt, deps.guestOrigin),
        keyed(attempt, 'create_session'),
      );
      await recordSession(deps, attempt, session, false);
      sessionId = session.id;
    } catch (error) {
      rethrowUnavailable(error);
      // Stripe never accepted the create: there is no session to expire.
      if (error.code === 'expires-at-invalid') return 'stale';
      throw error;
    }
  }
  const readOptions = { stripeAccount: attempt.stripeAccountId };
  try {
    await deps.gateway.expireCheckoutSession(sessionId, keyed(attempt, 'expire_session'));
  } catch (error) {
    rethrowUnavailable(error);
    // A rejection whose wording we don't know is checked against the session too.
    if (error.code !== 'session-not-open' && error.code !== 'rejected') throw error;
    const session = await deps.gateway.retrieveCheckoutSession(sessionId, readOptions);
    if (session.status === 'complete' && session.paymentIntentId) {
      // The completion webhook was lost or is late: authorize, and the void follows (S2 path F).
      return (await authorize(deps, { ...input, paymentIntentId: session.paymentIntentId }))
        .outcome;
    }
    if (session.status !== 'expired') throw error;
  }
  return (await sessionExpired(deps, input)).outcome;
}

async function refund(deps: PaymentDeps, attemptId: string): Promise<PaymentJobOutcome> {
  const { attempt } = await load(deps, attemptId);
  const input = { attemptId, trigger: 'payment_job' } as const;
  if (attempt.refundStatus === 'succeeded') return (await recordRefunded(deps, input)).outcome;
  if (attempt.refundStatus !== 'pending' || !attempt.paymentIntentId) return 'stale';
  let status: string;
  try {
    const created = await deps.gateway.createRefund(
      { paymentIntentId: attempt.paymentIntentId },
      keyed(attempt, 'refund'),
    );
    await deps.db
      .update(paymentAttempts)
      .set({ refundId: created.id, updatedAt: deps.now() })
      .where(eq(paymentAttempts.id, attempt.id));
    status = created.status;
  } catch (error) {
    rethrowUnavailable(error);
    if (error.code === 'charge-already-refunded') {
      return (await recordRefunded(deps, input)).outcome;
    }
    return (await recordRefundFailed(deps, input)).outcome;
  }
  if (status === 'succeeded') return (await recordRefunded(deps, input)).outcome;
  if (status === 'failed' || status === 'canceled') {
    return (await recordRefundFailed(deps, input)).outcome;
  }
  // `pending` / `requires_action`: the refund webhook finishes it.
  return 'waiting';
}

/** Runs one payment operation of an attempt. Throws when Stripe is unreachable (pg-boss retries). */
export async function runPaymentJob(
  deps: PaymentDeps,
  { attemptId, operation }: OrderPaymentJobData,
): Promise<PaymentJobResult> {
  const run = {
    open,
    confirm: confirmJob,
    capture,
    void: voidJob,
    expire_session: expireSession,
    refund,
  }[operation];
  return { operation, outcome: await run(deps, attemptId) };
}
