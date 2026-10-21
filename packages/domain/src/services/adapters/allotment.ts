import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { allotmentSlots } from '../../db/schema/offers';
import { inventoryHolds, orders } from '../../db/schema/orders';
import type { HoldState } from '../../orders/vocabulary';
import { endOfCivilDay, startOfCivilDay } from '../../time';
import { type AdapterContext, AdapterError, type ProviderAdapter } from './interface';

// Allotment: the seats from the deal live in `allotment_slots.remaining`. A hold takes seats under
// the slot's row lock and records an `inventory_holds` row; release and cancel give them back.
// Every seat change is keyed on the hold row's state change, so a repeat never counts twice.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Marks the proposal's hold released from one of `from` and returns its seats to the slot. */
async function giveBack(ctx: AdapterContext, proposalId: string, from: HoldState[]) {
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

/** Releases the proposal's hold, held or committed, and returns its seats: the machine's release. */
export function restoreSeats(ctx: AdapterContext, proposalId: string): Promise<void> {
  return giveBack(ctx, proposalId, ['held', 'committed']);
}

async function holdOf(ctx: AdapterContext, proposalId: string) {
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

export const allotmentAdapter: ProviderAdapter = {
  mode: 'allotment',

  async checkAvailability(ctx, { offerId, date, quantity, zone }) {
    const slots = await ctx.db
      .select()
      .from(allotmentSlots)
      .where(
        and(
          eq(allotmentSlots.offerId, offerId),
          gte(allotmentSlots.startsAt, startOfCivilDay(date, zone)),
          lt(allotmentSlots.startsAt, endOfCivilDay(date, zone)),
          gte(allotmentSlots.remaining, quantity),
        ),
      )
      .orderBy(asc(allotmentSlots.startsAt));
    return slots.map((s) => ({ slotId: s.id, startsAt: s.startsAt, remaining: s.remaining }));
  },

  async hold(ctx, { orderId, proposalId, slotId, quantity, expiresAt }) {
    if (!slotId) throw new AdapterError('invalid-input');
    const existing = await holdOf(ctx, proposalId);
    if (existing) return { ref: existing.id, expiresAt: existing.expiresAt };
    const [slot] = await ctx.db
      .select()
      .from(allotmentSlots)
      .where(eq(allotmentSlots.id, slotId))
      .for('update');
    if (!slot) throw new AdapterError('invalid-input');
    if (slot.remaining < quantity) throw new AdapterError('sold-out');
    await ctx.db
      .update(allotmentSlots)
      .set({ remaining: sql`${allotmentSlots.remaining} - ${quantity}` })
      .where(eq(allotmentSlots.id, slotId));
    const [hold] = await ctx.db
      .insert(inventoryHolds)
      .values({ orderId, proposalId, slotId, quantity, expiresAt, createdAt: ctx.now() })
      .returning();
    if (!hold) throw new Error('no hold');
    return { ref: hold.id, expiresAt: hold.expiresAt };
  },

  async commit(ctx, { orderId, proposalId }) {
    const [committed] = await ctx.db
      .update(inventoryHolds)
      .set({ state: 'committed', resolvedAt: ctx.now() })
      .where(and(eq(inventoryHolds.proposalId, proposalId), eq(inventoryHolds.state, 'held')))
      .returning({ id: inventoryHolds.id });
    if (!committed && (await holdOf(ctx, proposalId))?.state !== 'committed') {
      throw new AdapterError('hold-gone');
    }
    return { externalRef: orderId };
  },

  release: (ctx, { proposalId }) => giveBack(ctx, proposalId, ['held']),

  cancel: (ctx, { proposalId }) => giveBack(ctx, proposalId, ['committed']),

  async lookup(ctx, reference) {
    const order = await orderOf(ctx, reference);
    const hold = order?.proposalId ? await holdOf(ctx, order.proposalId) : undefined;
    if (!order || !hold) return { state: 'not_found', proposalId: null, externalRef: null };
    return { state: hold.state, proposalId: hold.proposalId, externalRef: order.externalRef };
  },

  async resolveInboundCancellation(ctx, { reference, proposalId }) {
    const order = await orderOf(ctx, reference);
    if (!order?.proposalId) return null;
    return { orderId: reference, proposalId: proposalId ?? order.proposalId };
  },
};
