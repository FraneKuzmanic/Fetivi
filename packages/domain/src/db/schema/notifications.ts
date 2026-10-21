import { pgEnum, pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';
import { ORDER_NOTIFICATIONS } from '../../orders/vocabulary';
import { orderProposals, orders } from './orders';

export const orderNotification = pgEnum('order_notification', ORDER_NOTIFICATIONS);

/** One sent notification per Order, proposal and kind; what makes a retried send a no-op. */
export const orderNotificationDeliveries = pgTable(
  'order_notification_deliveries',
  {
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => orderProposals.id, { onDelete: 'cascade' }),
    kind: orderNotification('kind').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.orderId, t.proposalId, t.kind] })],
);

export type OrderNotificationDeliveryRow = typeof orderNotificationDeliveries.$inferSelect;
