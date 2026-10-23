import {
  type OrderDeps,
  type PaymentGateway,
  QUEUE_OPTIONS,
  QUEUES,
  RECONCILE_CRON,
  runReconciliation,
} from '@fetivi/domain';
import type { JobDefinition } from '../runner';

export type ReconcileJobDeps = OrderDeps & {
  /** Null when STRIPE_SECRET_KEY is not set: the run then checks holds only. */
  gateway: PaymentGateway | null;
  guestOrigin: string;
};

/** Sent by the admin's Run now; the cron sends no data. */
export interface ReconcileJobData {
  trigger?: 'admin';
  requestedBy?: string;
}

/**
 * Every 5 minutes, and on demand: reads Stripe and expired holds and feeds what was missed back
 * through the Order machine. The queue is a singleton, so two runs never overlap.
 */
export function reconcileJob(deps: ReconcileJobDeps): JobDefinition<ReconcileJobData> {
  return {
    name: QUEUES.reconcile,
    queue: QUEUE_OPTIONS.reconcile,
    cron: RECONCILE_CRON,
    async handler(data) {
      const summary = await runReconciliation(
        deps,
        data?.trigger === 'admin'
          ? { trigger: 'admin', requestedBy: data.requestedBy }
          : { trigger: 'schedule' },
      );
      // Ids and counts only.
      console.log(JSON.stringify({ job: QUEUES.reconcile, ...summary }));
    },
  };
}
