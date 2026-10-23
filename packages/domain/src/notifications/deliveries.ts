import type { Db } from '../db/client';
import { orderNotificationDeliveries } from '../db/schema/notifications';
import type { OrderNotification } from '../orders/vocabulary';

export interface DeliveryKey {
  orderId: string;
  proposalId: string;
  kind: OrderNotification;
  /** The flagging OrderEvent of an `admin_payment_attention`: one alert per flag. */
  eventId?: number;
}

/**
 * Sends at most once per Order, proposal and kind. The delivery row and the send share one
 * transaction: a failed send leaves no row, so the job's retry sends again, and a concurrent
 * duplicate waits on the row and then sees it. This is not an Order transaction, so no Order
 * lock is held during the send. If the send succeeds but the commit is lost, a retry sends once
 * more; the message's idempotency key lets a real transport collapse that.
 */
export async function deliverOnce(
  db: Db,
  key: DeliveryKey,
  now: Date,
  send: () => Promise<void>,
): Promise<'sent' | 'already_sent'> {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(orderNotificationDeliveries)
      .values({
        orderId: key.orderId,
        proposalId: key.proposalId,
        kind: key.kind,
        eventId: key.eventId ?? 0,
        sentAt: now,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted.length === 0) return 'already_sent';
    await send();
    return 'sent';
  });
}
