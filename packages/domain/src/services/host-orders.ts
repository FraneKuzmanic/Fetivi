import { and, count, desc, eq, gte, isNull, ne, notInArray, or } from 'drizzle-orm';
import type { Executor } from '../db/client';
import { offers } from '../db/schema/offers';
import { orderProposals, orders } from '../db/schema/orders';
import { FINAL_ORDER_STATUSES } from '../orders/vocabulary';
import { type ProviderLinkView, providerLinkView, providerOrderQuery } from './provider-link/link';

// A host answers the Orders on their own Offers from the back-office inbox (38, ADR 0016): the
// same view and actions as a Provider's per-order link, reached through the session instead of a
// token, and only for Offers with `offers.host_id` = the host.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIST_LIMIT = 100;
const FINAL_DAYS = 30;

export interface HostOrder extends ProviderLinkView {
  offerId: string;
  createdAt: Date;
  /** Something is asked of the host: an unanswered request or an unacknowledged Order. */
  waiting: boolean;
}

const isWaiting = (view: ProviderLinkView) => view.actions.some((a) => a !== 'cannot_fulfil');

/** The host's own-Offer Order with what the Provider page would show; undefined otherwise. */
export async function findHostOrder(db: Executor, hostId: string, orderId: string) {
  if (!UUID.test(orderId)) return undefined;
  const [row] = await providerOrderQuery(db).where(
    and(eq(orders.id, orderId), eq(offers.hostId, hostId)),
  );
  return row;
}

/**
 * The host's own-Offer Orders, newest first. Leaves out the guest's own first tap (nothing is
 * asked of the host until it is paid or confirmed) and final Orders older than 30 days.
 */
export async function listHostOrders(
  db: Executor,
  hostId: string,
  now: Date,
): Promise<HostOrder[]> {
  const since = new Date(now.getTime() - FINAL_DAYS * 24 * 60 * 60 * 1000);
  const rows = await providerOrderQuery(db)
    .where(
      and(
        eq(offers.hostId, hostId),
        or(
          notInArray(orders.status, ['awaiting_confirmation', 'confirming']),
          ne(orderProposals.proposer, 'offer'),
        ),
        or(notInArray(orders.status, [...FINAL_ORDER_STATUSES]), gte(orders.updatedAt, since)),
      ),
    )
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(LIST_LIMIT);
  return rows.map((row) => {
    const view = providerLinkView(row);
    return {
      ...view,
      offerId: row.order.offerId,
      createdAt: row.order.createdAt,
      waiting: isWaiting(view),
    };
  });
}

/** How many own-Offer Orders wait for the host: the inbox badge's Order part. */
export async function hostOrdersWaiting(db: Executor, hostId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(orders)
    .innerJoin(offers, eq(offers.id, orders.offerId))
    .innerJoin(orderProposals, eq(orderProposals.id, orders.currentProposalId))
    .where(
      and(
        eq(offers.hostId, hostId),
        or(
          and(eq(orders.status, 'pending_provider'), eq(orders.availabilityMode, 'on_request')),
          and(
            eq(orders.status, 'confirmed'),
            eq(orders.availabilityMode, 'allotment'),
            isNull(orderProposals.providerAcknowledgedAt),
          ),
        ),
      ),
    );
  return row?.n ?? 0;
}
