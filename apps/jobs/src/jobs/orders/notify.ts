import { type OrderNotifyJobData, QUEUE_OPTIONS, QUEUES } from '@fetivi/domain';
import type { JobDefinition } from '../../runner';

/**
 * Sending arrives with 15 (Provider email) and 25 (guest channels); the job is enqueued exactly
 * once per Order, proposal and kind.
 */
export function orderNotifyJob(): JobDefinition<OrderNotifyJobData> {
  return {
    name: QUEUES.orderNotify,
    queue: QUEUE_OPTIONS.orderNotify,
    async handler({ orderId, proposalId, kind }) {
      console.log(JSON.stringify({ job: QUEUES.orderNotify, orderId, proposalId, kind }));
    },
  };
}
