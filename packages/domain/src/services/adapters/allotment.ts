import { and, asc, eq, gte, lt, sql } from 'drizzle-orm';
import { allotmentSlots } from '../../db/schema/offers';
import { inventoryHolds } from '../../db/schema/orders';
import { endOfCivilDay, startOfCivilDay } from '../../time';
import { commitHold, giveBack, holdOf, lookupHold, resolveByOrder } from './holds';
import { type AdapterContext, AdapterError, type ProviderAdapter } from './interface';

// Allotment: the seats from the deal live in `allotment_slots.remaining`. A hold takes seats under
// the slot's row lock and records an `inventory_holds` row; release and cancel give them back.
// Every seat change is keyed on the hold row's state change, so a repeat never counts twice.

/** Releases the proposal's hold, held or committed, and returns its seats: the machine's release. */
export function restoreSeats(ctx: AdapterContext, proposalId: string): Promise<void> {
  return giveBack(ctx, proposalId, ['held', 'committed']);
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
    if (existing?.state === 'released') throw new AdapterError('hold-gone');
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

  commit: commitHold,

  release: (ctx, { proposalId }) => giveBack(ctx, proposalId, ['held']),

  cancel: (ctx, { proposalId }) => giveBack(ctx, proposalId, ['committed']),

  lookup: lookupHold,

  resolveInboundCancellation: resolveByOrder,
};
