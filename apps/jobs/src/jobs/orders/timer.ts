import {
  type OrderDeps,
  type OrderTimerJobData,
  QUEUE_OPTIONS,
  QUEUES,
  runOrderTimer,
} from '@fetivi/domain';
import type { JobDefinition } from '../../runner';

/** Hands a due Order timer back to the machine, which ignores a stale or not-yet-due one. */
export function orderTimerJob(deps: OrderDeps): JobDefinition<OrderTimerJobData> {
  return {
    name: QUEUES.orderTimer,
    queue: QUEUE_OPTIONS.orderTimer,
    async handler(data) {
      const { outcome } = await runOrderTimer(deps, data);
      // Ids and outcome only, never contact fields.
      console.log(JSON.stringify({ job: QUEUES.orderTimer, ...data, outcome }));
    },
  };
}
