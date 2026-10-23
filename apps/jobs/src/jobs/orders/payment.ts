import {
  type OrderDeps,
  type OrderPaymentJobData,
  type PaymentGateway,
  QUEUE_OPTIONS,
  QUEUES,
  runPaymentJob,
} from '@fetivi/domain';
import type { JobDefinition } from '../../runner';

export type OrderPaymentJobDeps = OrderDeps & {
  /** Null when STRIPE_SECRET_KEY is not set: the job then fails visibly. */
  gateway: PaymentGateway | null;
  guestOrigin: string;
};

/** Runs one Stripe write of a pay-online Order; a thrown error lets pg-boss retry it. */
export function orderPaymentJob(deps: OrderPaymentJobDeps): JobDefinition<OrderPaymentJobData> {
  return {
    name: QUEUES.orderPayment,
    queue: QUEUE_OPTIONS.orderPayment,
    async handler(data) {
      const { gateway } = deps;
      if (!gateway) throw new Error('stripe-not-configured');
      const { outcome } = await runPaymentJob({ ...deps, gateway }, data);
      // Ids and outcome only, never contact fields.
      console.log(JSON.stringify({ job: QUEUES.orderPayment, ...data, outcome }));
    },
  };
}
