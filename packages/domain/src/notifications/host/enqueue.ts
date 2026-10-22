import type { Executor } from '../../db/client';
import { type JobQueue, QUEUES, uuidFrom } from '../../jobs/queue';

/** Ids only, never contact fields. A digest names its host and its slot instant (ISO). */
export type HostNotifyJobData =
  | { kind: 'message'; handoffId: string }
  | { kind: 'digest'; hostId: string; slot: string };

/**
 * The notification's content-derived key: the job id, the claim on `handoff_messages`, the ledger
 * key and the base of the email idempotency key.
 */
export function hostNotificationKey(data: HostNotifyJobData): string {
  return data.kind === 'message'
    ? `handoff:${data.handoffId}:host`
    : `host:${data.hostId}:digest:${data.slot}`;
}

/** Enqueues a host notification inside `tx`; the same key is enqueued once. */
export async function enqueueHostNotification(
  tx: Executor,
  queue: JobQueue,
  data: HostNotifyJobData,
): Promise<void> {
  await queue.send(QUEUES.hostNotify, data, tx, { id: uuidFrom(hostNotificationKey(data)) });
}
