import {
  type AvailabilityMode,
  type OrderAdapterCancelJobData,
  type OrderDeps,
  type ProviderAdapter,
  QUEUE_OPTIONS,
  QUEUES,
  runAdapterCancel,
} from '@fetivi/domain';
import type { JobDefinition } from '../../runner';

export type OrderAdapterCancelJobDeps = OrderDeps & {
  /** The Provider system per availability mode; tests pass a fake. */
  adapters?: (mode: AvailabilityMode) => ProviderAdapter;
};

/**
 * Cancels a live Order in the Provider's system, outside the cancel's transaction (35). A thrown
 * error lets pg-boss retry it; until the live adapter exists (37) every attempt fails visibly.
 */
export function orderAdapterCancelJob(
  deps: OrderAdapterCancelJobDeps,
): JobDefinition<OrderAdapterCancelJobData> {
  return {
    name: QUEUES.orderAdapterCancel,
    queue: QUEUE_OPTIONS.orderAdapterCancel,
    async handler(data) {
      const outcome = await runAdapterCancel(deps, data, deps.adapters);
      // Ids and outcome only, never guest data.
      console.log(JSON.stringify({ job: QUEUES.orderAdapterCancel, ...data, outcome }));
    },
  };
}
