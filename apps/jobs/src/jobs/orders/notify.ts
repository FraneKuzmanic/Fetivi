import {
  deliverGuestNotification,
  type GuestDeliveryResult,
  type GuestNotifyDeps,
  isOrderGuestKind,
  type NotifyDeps,
  type OrderNotifyJobData,
  QUEUE_OPTIONS,
  QUEUES,
  type SendOutcome,
  sendAdminAlert,
  sendProviderNotification,
} from '@fetivi/domain';
import type { JobDefinition } from '../../runner';

/**
 * Sends an Order notification. The job is enqueued once per Order, proposal and kind, and the
 * send records its delivery, so a retry never sends twice. The guest kinds go to the guest's
 * inbox, email and push; the Provider gets the confirmed Order or the on-request ask, and the
 * admins the alerts.
 */
export function orderNotifyJob(
  deps: NotifyDeps & GuestNotifyDeps,
): JobDefinition<OrderNotifyJobData> {
  return {
    name: QUEUES.orderNotify,
    queue: QUEUE_OPTIONS.orderNotify,
    async handler({ orderId, proposalId, kind, eventId }) {
      let outcome: SendOutcome | GuestDeliveryResult | 'logged';
      switch (kind) {
        case 'provider_confirmed':
        case 'provider_request':
          outcome = await sendProviderNotification(deps, { orderId, proposalId, kind });
          break;
        case 'admin_provider_cancelled':
        case 'admin_payment_attention':
        case 'admin_window_missed':
          outcome = await sendAdminAlert(deps, { orderId, proposalId, kind, eventId });
          break;
        default:
          outcome = isOrderGuestKind(kind)
            ? await deliverGuestNotification(deps, { kind, orderId, proposalId })
            : 'logged';
      }
      // Ids and outcome only, never contact fields.
      console.log(JSON.stringify({ job: QUEUES.orderNotify, orderId, proposalId, kind, outcome }));
    },
  };
}
