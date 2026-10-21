import {
  type NotifyDeps,
  type OrderNotifyJobData,
  QUEUE_OPTIONS,
  QUEUES,
  sendAdminAlert,
  sendProviderNotification,
} from '@fetivi/domain';
import type { JobDefinition } from '../../runner';

/**
 * Sends an Order notification. The job is enqueued once per Order, proposal and kind, and the
 * send records its delivery, so a retry never sends twice. Guest channels arrive with 25 and the
 * on-request Provider email with 36; until then those kinds are only logged.
 */
export function orderNotifyJob(deps: NotifyDeps): JobDefinition<OrderNotifyJobData> {
  return {
    name: QUEUES.orderNotify,
    queue: QUEUE_OPTIONS.orderNotify,
    async handler({ orderId, proposalId, kind }) {
      let outcome: string;
      switch (kind) {
        case 'provider_confirmed':
          outcome = await sendProviderNotification(deps, { orderId, proposalId, kind });
          break;
        case 'admin_provider_cancelled':
          outcome = await sendAdminAlert(deps, { orderId, proposalId, kind });
          break;
        default:
          outcome = 'logged';
      }
      // Ids and outcome only, never contact fields.
      console.log(JSON.stringify({ job: QUEUES.orderNotify, orderId, proposalId, kind, outcome }));
    },
  };
}
