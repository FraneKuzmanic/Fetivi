import { inventoryHolds } from '../../db/schema/orders';
import { commitHold, giveBack, holdOf, lookupHold, resolveByOrder } from './holds';
import { AdapterError, type ProviderAdapter } from './interface';

// On request: the Provider decides, so there is no capacity to take. The hold is a capacity-free
// `inventory_holds` row (no slot), which keeps the machine's hold, commit and release unchanged.

export const onRequestAdapter: ProviderAdapter = {
  mode: 'on_request',

  // The date checks already ran; the Provider answers for the time.
  async checkAvailability() {
    return [{ slotId: null, startsAt: null, remaining: null }];
  },

  async hold(ctx, { orderId, proposalId, quantity, expiresAt }) {
    const existing = await holdOf(ctx, proposalId);
    if (existing?.state === 'released') throw new AdapterError('hold-gone');
    if (existing) return { ref: existing.id, expiresAt: existing.expiresAt };
    const [hold] = await ctx.db
      .insert(inventoryHolds)
      .values({ orderId, proposalId, quantity, expiresAt, createdAt: ctx.now() })
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
