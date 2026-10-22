import type { SafetyAlertFacts } from '../../alerts/vocabulary';
import type { Executor } from '../../db/client';
import { type JobQueue, QUEUES, uuidFrom } from '../../jobs/queue';
import { orderJobKey } from '../../orders/timers';
import { type GuestNotificationKind, isOrderGuestKind } from './vocabulary';

/**
 * Ids and kind only, never contact fields. `spaceId` may be left out for the Order kinds: the
 * order-notify job carries only the Order, and the loader finds the space from it.
 */
export interface GuestNotifyJobData {
  kind: GuestNotificationKind;
  spaceId?: string;
  orderId?: string;
  proposalId?: string;
  handoffId?: string;
  /** Safety kinds carry their facts: the feed may have changed by send time. No contact fields. */
  safety?: SafetyAlertFacts;
}

/**
 * The notification's content-derived key: the job id, the ledger key and the base of the email
 * idempotency key. Order kinds use the order-notify job's key, so their format stays the same.
 */
export function guestNotificationKey(data: GuestNotifyJobData): string {
  const { kind } = data;
  if (isOrderGuestKind(kind)) {
    return orderJobKey(need(data.orderId, kind), need(data.proposalId, kind), `notify:${kind}`);
  }
  if (kind === 'order_reminder') {
    return `order:${need(data.orderId, kind)}:proposal:${need(data.proposalId, kind)}:remind`;
  }
  if (kind === 'host_reply') return `handoff:${need(data.handoffId, kind)}:host_reply`;
  // Safety keys leave out the language, area and advisory: one alert per warning or notice.
  if (kind === 'weather_warning') {
    const w = data.safety;
    if (w?.source !== 'DHMZ') throw new Error(`guest notification ${kind} is missing its facts`);
    return `space:${need(data.spaceId, kind)}:${kind}:${w.type}:${w.level}:${w.onset}:${w.expires}`;
  }
  if (kind === 'ferry_disruption') {
    const d = data.safety;
    if (d?.source !== 'Jadrolinija') {
      throw new Error(`guest notification ${kind} is missing its facts`);
    }
    return `space:${need(data.spaceId, kind)}:${kind}:jadrolinija:${d.noticeId}`;
  }
  return `space:${need(data.spaceId, kind)}:${kind}`;
}

function need(value: string | undefined, kind: GuestNotificationKind): string {
  if (!value) throw new Error(`guest notification ${kind} is missing an id`);
  return value;
}

/** Enqueues a guest notification inside `tx`; the same key is enqueued once. */
export async function enqueueGuestNotification(
  tx: Executor,
  queue: JobQueue,
  data: GuestNotifyJobData,
  startAfter?: Date,
): Promise<void> {
  const id = uuidFrom(guestNotificationKey(data));
  await queue.send(QUEUES.guestNotify, data, tx, startAfter ? { id, startAfter } : { id });
}
