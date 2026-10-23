import type { Executor } from '../db/client';
import { type JobQueue, QUEUES, uuidFrom } from '../jobs/queue';
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
  /** The OrderEvent whose note says why, for `admin_payment_attention` (33). */
  eventId?: number;
}

/** Ids only: the job reads the Order and its reference itself. */
export interface OrderAdapterCancelJobData {
  orderId: string;
  proposalId: string;
}

/**
 * The operation part of an Order job's key: a timer, a notification, a payment job (33) or the
 * Provider system's cancel (35).
 */
export type OrderJobOperation =
  | TimerOperation
  | `${TimerOperation}:${string}`
  | `notify:${OrderNotification}`
  | `notify:${OrderNotification}:${number}`
  | `payment:${string}`
  | 'adapter-cancel';

export function orderJobKey(
  orderId: string,
  proposalId: string,
  operation: OrderJobOperation,
): string {
  return `order:${orderId}:proposal:${proposalId}:${operation}`;
}

export function orderJobId(
  orderId: string,
  proposalId: string,
  operation: OrderJobOperation,
): string {
  return uuidFrom(orderJobKey(orderId, proposalId, operation));
}

/**
 * Schedules a timer inside `tx`, due at `at`. `keySuffix` names a second timer of the same
 * operation (a restamped hold's new expiry, 33), which the first one's key would swallow.
 */
export async function scheduleTimer(
  tx: Executor,
  queue: JobQueue,
  data: OrderTimerJobData,
  at: Date,
  keySuffix?: string,
): Promise<void> {
  const operation: OrderJobOperation =
    keySuffix === undefined ? data.operation : `${data.operation}:${keySuffix}`;
  const id = orderJobId(data.orderId, data.proposalId, operation);
  await queue.send(QUEUES.orderTimer, data, tx, { id, startAfter: at });
}

/** Enqueues the live engine's cancel inside `tx`, once per Order and proposal. */
export async function enqueueAdapterCancel(
  tx: Executor,
  queue: JobQueue,
  data: OrderAdapterCancelJobData,
): Promise<void> {
  const id = orderJobId(data.orderId, data.proposalId, 'adapter-cancel');
  await queue.send(QUEUES.orderAdapterCancel, data, tx, { id });
}

/** Enqueues a notification inside `tx`, once per Order, proposal and kind (and `eventId`). */
export async function enqueueNotification(
  tx: Executor,
  queue: JobQueue,
  data: OrderNotifyJobData,
): Promise<void> {
  const operation: OrderJobOperation =
    data.eventId === undefined ? `notify:${data.kind}` : `notify:${data.kind}:${data.eventId}`;
  const id = orderJobId(data.orderId, data.proposalId, operation);
  await queue.send(QUEUES.orderNotify, data, tx, { id });
}
