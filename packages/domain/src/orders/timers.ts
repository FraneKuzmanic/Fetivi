import type { Executor } from '../db/client';
import { type JobQueue, QUEUES, uuidFrom } from '../jobs/queue';
import {
  complete,
  expire,
  type OrderDeps,
  responseWindowMissed,
  type TransitionOutcome,
} from './machine';
import type { OrderNotification, TimerOperation } from './vocabulary';

// Order timers and notifications are pg-boss jobs keyed by Order id + proposal id + operation,
// so pg-boss ignores a second insert of the same job. A timer only names its proposal; the
// machine decides whether it is stale or not yet due.

export interface OrderTimerJobData {
  orderId: string;
  proposalId: string;
  operation: TimerOperation;
}

/** Ids and kind only: never contact fields. */
export interface OrderNotifyJobData {
  orderId: string;
  proposalId: string;
  kind: OrderNotification;
}

export function orderJobKey(
  orderId: string,
  proposalId: string,
  operation: TimerOperation | `notify:${OrderNotification}`,
): string {
  return `order:${orderId}:proposal:${proposalId}:${operation}`;
}

export function orderJobId(
  orderId: string,
  proposalId: string,
  operation: TimerOperation | `notify:${OrderNotification}`,
): string {
  return uuidFrom(orderJobKey(orderId, proposalId, operation));
}

/** Schedules a timer inside `tx`, due at `at`. */
export async function scheduleTimer(
  tx: Executor,
  queue: JobQueue,
  data: OrderTimerJobData,
  at: Date,
): Promise<void> {
  const id = orderJobId(data.orderId, data.proposalId, data.operation);
  await queue.send(QUEUES.orderTimer, data, tx, { id, startAfter: at });
}

/** Enqueues a notification inside `tx`, once per Order, proposal and kind. */
export async function enqueueNotification(
  tx: Executor,
  queue: JobQueue,
  data: OrderNotifyJobData,
): Promise<void> {
  const id = orderJobId(data.orderId, data.proposalId, `notify:${data.kind}`);
  await queue.send(QUEUES.orderNotify, data, tx, { id });
}

/** The order-timer job: hands a due timer back to the machine. */
export async function runOrderTimer(
  deps: OrderDeps,
  { orderId, proposalId, operation }: OrderTimerJobData,
): Promise<TransitionOutcome> {
  switch (operation) {
    case 'card_expiry':
      return expire(deps, { orderId, proposalId, trigger: 'card_timer' });
    case 'hold_expiry':
      return expire(deps, { orderId, proposalId, trigger: 'hold_timer' });
    case 'completion':
      return complete(deps, { orderId, proposalId, trigger: 'completion_timer' });
    case 'response_window':
      return responseWindowMissed(deps, { orderId, proposalId });
  }
}
