import { and, eq, inArray, sql } from 'drizzle-orm';
import { allotmentSlots } from '../../db/schema/offers';
import { inventoryHolds, orders } from '../../db/schema/orders';
import type { HoldState } from '../../orders/vocabulary';
import {
  type AdapterContext,
  AdapterError,
  type LookupResult,
  type ProposalRef,
} from './interface';

// The `inventory_holds` bookkeeping the allotment and on-request adapters share, so the two keep
// the same contract. A hold without a slot takes and returns no capacity.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Marks the proposal's hold released from one of `from` and returns its seats to the slot. */
export async function giveBack(ctx: AdapterContext, proposalId: string, from: HoldState[]) {
  const [released] = await ctx.db
    .update(inventoryHolds)
    .set({ state: 'released', resolvedAt: ctx.now() })
    .where(and(eq(inventoryHolds.proposalId, proposalId), inArray(inventoryHolds.state, from)))
    .returning();
  if (released?.slotId) {
    await ctx.db
      .update(allotmentSlots)
      .set({ remaining: sql`${allotmentSlots.remaining} + ${released.quantity}` })
      .where(eq(allotmentSlots.id, released.slotId));
  }
}

export async function holdOf(ctx: AdapterContext, proposalId: string) {
  const [hold] = await ctx.db
    .select()
    .from(inventoryHolds)
    .where(eq(inventoryHolds.proposalId, proposalId));
  return hold;
}

/** The Order a reference names; the reference is the Order id. */
async function orderOf(ctx: AdapterContext, reference: string) {
  if (!UUID.test(reference)) return undefined;
  const [order] = await ctx.db
    .select({ proposalId: orders.currentProposalId, externalRef: orders.providerExternalRef })
    .from(orders)
    .where(eq(orders.id, reference));
  return order;
}

/** Turns the proposal's hold into a reservation under the Order id. Idempotent. */
export async function commitHold(
  ctx: AdapterContext,
  { orderId, proposalId }: ProposalRef,
): Promise<{ externalRef: string }> {
  const [committed] = await ctx.db
    .update(inventoryHolds)
    .set({ state: 'committed', resolvedAt: ctx.now() })
    .where(and(eq(inventoryHolds.proposalId, proposalId), eq(inventoryHolds.state, 'held')))
    .returning({ id: inventoryHolds.id });
  if (!committed && (await holdOf(ctx, proposalId))?.state !== 'committed') {
    throw new AdapterError('hold-gone');
  }
  return { externalRef: orderId };
}

export async function lookupHold(ctx: AdapterContext, reference: string): Promise<LookupResult> {
  const order = await orderOf(ctx, reference);
  const hold = order?.proposalId ? await holdOf(ctx, order.proposalId) : undefined;
  if (!order || !hold) return { state: 'not_found', proposalId: null, externalRef: null };
  return { state: hold.state, proposalId: hold.proposalId, externalRef: order.externalRef };
}

export async function resolveByOrder(
  ctx: AdapterContext,
  { reference, proposalId }: { reference: string; proposalId?: string },
): Promise<ProposalRef | null> {
  const order = await orderOf(ctx, reference);
  if (!order?.proposalId) return null;
  return { orderId: reference, proposalId: proposalId ?? order.proposalId };
}
