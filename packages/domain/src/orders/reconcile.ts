import { and, asc, eq, lte } from 'drizzle-orm';
import type { Executor } from '../db/client';
import { type InventoryHoldRow, inventoryHolds, orders } from '../db/schema/orders';
import {
  RECONCILE_CONFIRM_GRACE_MINUTES,
  RECONCILE_HOLD_GRACE_MINUTES,
} from '../payments/vocabulary';
import { type OrderDeps, OrderRuleError, releaseHold, releaseIn } from './machine';
import { flagPaymentAttentionIn } from './payments';
import { isFinalOrderStatus, type OrderStatus } from './vocabulary';

// Holds still `held` past their expiry, resolved by the reconciliation job (34): a lost or stale
// hold timer, a dead confirm job or a restore can leave one behind.

export type HoldOutcome = 'expired' | 'failed' | 'released' | 'reported' | 'waiting' | 'none';

const minutes = (n: number) => n * 60_000;

/** Holds still `held` past `expires_at` plus the unpaid grace, oldest first. */
export function expiredHolds(db: Executor, now: Date, limit: number): Promise<InventoryHoldRow[]> {
  const before = new Date(now.getTime() - minutes(RECONCILE_HOLD_GRACE_MINUTES));
  return db
    .select()
    .from(inventoryHolds)
    .where(and(eq(inventoryHolds.state, 'held'), lte(inventoryHolds.expiresAt, before)))
    .orderBy(asc(inventoryHolds.expiresAt))
    .limit(limit);
}

/**
 * One held hold past expiry, resolved through the machine under the Order lock:
 * - current proposal, Order `confirming`, Payment `none` → expire (trigger `reconciliation`)
 * - current proposal, Order `confirming`, Payment `authorized` → fail + admin flag once the
 *   confirm grace has passed, else `waiting`
 * - Order final or `awaiting_confirmation`, or the proposal is not current → the hold is
 *   released through the adapter release (`releaseHold`)
 * - any other Order (`confirmed`, `pending_provider`, `confirming` with another Payment) →
 *   `reported`, never touched
 * A hold no longer held or not yet past the grace is `none`: its timer or a webhook won the race.
 * `orderStatus` is the Order's status before any change.
 */
export function reconcileHold(
  deps: OrderDeps,
  holdId: string,
): Promise<{ outcome: HoldOutcome; orderId: string; orderStatus: OrderStatus }> {
  return deps.db.transaction(async (tx) => {
    const [found] = await tx
      .select({ orderId: inventoryHolds.orderId })
      .from(inventoryHolds)
      .where(eq(inventoryHolds.id, holdId));
    if (!found) throw new OrderRuleError('not-found');
    const { orderId } = found;
    // Lock order: the Order row first, then the hold (and, inside the machine, attempt and slot).
    // Locked by hand, not with `withLockedOrder`: a hold of a superseded proposal is resolved
    // too, where that helper answers `stale`.
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
    if (!order) throw new OrderRuleError('not-found');
    const done = (outcome: HoldOutcome) => ({ outcome, orderId, orderStatus: order.status });
    const [hold] = await tx
      .select()
      .from(inventoryHolds)
      .where(eq(inventoryHolds.id, holdId))
      .for('update');
    const now = deps.now();
    if (
      hold?.state !== 'held' ||
      hold.expiresAt.getTime() + minutes(RECONCILE_HOLD_GRACE_MINUTES) > now.getTime()
    ) {
      return done('none');
    }
    const current = order.currentProposalId === hold.proposalId;
    if (!current || isFinalOrderStatus(order.status) || order.status === 'awaiting_confirmation') {
      await releaseHold(tx, deps, hold.proposalId);
      return done('released');
    }
    if (order.status !== 'confirming') return done('reported');
    const ref = { orderId, proposalId: hold.proposalId, trigger: 'reconciliation' as const };
    if (order.paymentStatus === 'none') {
      const expired = await releaseIn(tx, deps, order, 'expire', ref);
      return done(expired.outcome === 'applied' ? 'expired' : 'none');
    }
    if (order.paymentStatus !== 'authorized') return done('reported');
    // The confirm job has its retries before the Order is given up on.
    if (hold.expiresAt.getTime() + minutes(RECONCILE_CONFIRM_GRACE_MINUTES) > now.getTime()) {
      return done('waiting');
    }
    const failed = await releaseIn(tx, deps, order, 'fail', {
      ...ref,
      note: 'not confirmed before the hold expired',
    });
    if (failed.outcome !== 'applied') return done('none');
    await flagPaymentAttentionIn(tx, deps, failed.order, hold.proposalId);
    return done('failed');
  });
}
