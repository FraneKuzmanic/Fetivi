import { eq } from 'drizzle-orm';
import { orders } from '../../db/schema/orders';
import type { AvailabilityMode } from '../../offers/vocabulary';
import { cancel, confirm, type OrderDeps, type TransitionOutcome } from '../../orders/machine';
import { allotmentAdapter } from './allotment';
import {
  AdapterError,
  type InboundCancellation,
  type ProposalRef,
  type ProviderAdapter,
} from './interface';
import { onRequestAdapter } from './on-request';

export { allotmentAdapter, restoreSeats } from './allotment';
export * from './interface';
export { onRequestAdapter } from './on-request';

/** The adapter of an availability mode. */
export function adapterFor(mode: AvailabilityMode): ProviderAdapter {
  switch (mode) {
    case 'allotment':
      return allotmentAdapter;
    case 'on_request':
      return onRequestAdapter;
    // Live (Bókun) is ticket 37.
    case 'live':
      throw new AdapterError('not-supported');
  }
}

/**
 * Commits the proposal's hold with the Provider's system and confirms the Order under the
 * returned reference. A hold that is gone (its timer expired the Order) is `stale`.
 */
export async function confirmHeldOrder(
  deps: OrderDeps,
  ref: ProposalRef,
): Promise<TransitionOutcome> {
  const [order] = await deps.db.select().from(orders).where(eq(orders.id, ref.orderId));
  if (!order) throw new AdapterError('invalid-input');
  const adapter = adapterFor(order.availabilityMode);
  let externalRef: string;
  try {
    ({ externalRef } = await adapter.commit({ db: deps.db, now: deps.now }, ref));
  } catch (error) {
    if (error instanceof AdapterError && error.code === 'hold-gone') {
      const [current] = await deps.db.select().from(orders).where(eq(orders.id, ref.orderId));
      return { outcome: 'stale', order: current ?? order };
    }
    throw error;
  }
  return confirm(deps, { ...ref, trigger: 'adapter', providerExternalRef: externalRef });
}

/**
 * A cancellation from the Provider's side: the adapter names the Order, and the machine cancels
 * it and returns the capacity. Null when the adapter does not know the reference.
 */
export async function handleInboundCancellation(
  deps: OrderDeps,
  adapter: ProviderAdapter,
  event: InboundCancellation,
  trigger: 'provider_link' | 'admin',
  note?: string,
  actorId?: string,
): Promise<TransitionOutcome | null> {
  const ref = await adapter.resolveInboundCancellation({ db: deps.db, now: deps.now }, event);
  if (!ref) return null;
  return cancel(deps, { ...ref, trigger, note, actorId });
}
