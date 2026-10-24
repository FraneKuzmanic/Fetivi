import { createHash } from 'node:crypto';
import { type SQLChunk, sql } from 'drizzle-orm';
import type { Db as BossDb, PgBoss, Queue } from 'pg-boss';
import type { Executor } from '../db/client';

export const QUEUES = {
  translateBlock: 'translate-block',
  translateCatalogRecord: 'translate-catalog-record',
  translateOffer: 'translate-offer',
  translateHostPlace: 'translate-host-place',
  orderTimer: 'order-timer',
  orderNotify: 'order-notify',
  orderPayment: 'order-payment',
  orderAdapterCancel: 'order-adapter-cancel',
  pollCalendars: 'poll-calendars',
  pollCalendar: 'poll-calendar',
  stayNotify: 'stay-notify',
  translateHandoff: 'translate-handoff',
  guestNotify: 'guest-notify',
  guestReminders: 'guest-reminders',
  hostNotify: 'host-notify',
  hostDigests: 'host-digests',
  spaceEmail: 'space-email',
  safetyAlerts: 'safety-alerts',
  dailyTips: 'daily-tips',
  reconcile: 'reconcile',
  clusterFallbacks: 'cluster-fallbacks',
  importOpenData: 'import-open-data',
  draftPlace: 'draft-place',
  refreshCatalog: 'refresh-catalog',
  retention: 'retention',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const EVENTS = { unitProjectionInvalidated: 'unit-projection-invalidated' } as const;

export const QUEUE_OPTIONS: Record<keyof typeof QUEUES, Omit<Queue, 'name'>> = {
  // pg-boss retries cover crashes and DB errors; model failures end as a visible 'failed' status.
  translateBlock: { retryLimit: 2, retryDelay: 30, retryBackoff: true, expireInSeconds: 600 },
  translateCatalogRecord: {
    retryLimit: 2,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 600,
  },
  translateOffer: { retryLimit: 2, retryDelay: 30, retryBackoff: true, expireInSeconds: 600 },
  translateHostPlace: { retryLimit: 2, retryDelay: 30, retryBackoff: true, expireInSeconds: 600 },
  // Short database work; the machine makes a retried or duplicate run a no-op.
  orderTimer: { retryLimit: 5, retryDelay: 10, retryBackoff: true, expireInSeconds: 120 },
  orderNotify: { retryLimit: 5, retryDelay: 10, retryBackoff: true, expireInSeconds: 120 },
  // Stripe calls under idempotency keys; a retry replays the same request.
  orderPayment: { retryLimit: 8, retryDelay: 10, retryBackoff: true, expireInSeconds: 120 },
  // A Provider system's cancel, idempotent per the adapter contract; retried like a payment call.
  orderAdapterCancel: { retryLimit: 8, retryDelay: 10, retryBackoff: true, expireInSeconds: 120 },
  // The cron fan-out; the next slot runs again anyway.
  pollCalendars: { retryLimit: 1, expireInSeconds: 120 },
  // One feed; a failed fetch is recorded on the feed, so retries cover crashes only.
  pollCalendar: { retryLimit: 2, retryDelay: 60, retryBackoff: true, expireInSeconds: 120 },
  stayNotify: { retryLimit: 5, retryDelay: 10, retryBackoff: true, expireInSeconds: 120 },
  // One short message; a model failure ends as a visible 'failed' state, so retries cover crashes.
  translateHandoff: { retryLimit: 2, retryDelay: 30, retryBackoff: true, expireInSeconds: 120 },
  // Each channel's ledger row makes a retried or duplicate run send nothing twice.
  guestNotify: { retryLimit: 5, retryDelay: 10, retryBackoff: true, expireInSeconds: 120 },
  // The cron fan-out; the next slot runs again anyway.
  guestReminders: { retryLimit: 1, expireInSeconds: 120 },
  // The claim and the ledger make a retry send nothing twice.
  hostNotify: { retryLimit: 5, retryDelay: 10, retryBackoff: true, expireInSeconds: 120 },
  // The cron fan-out; the next slot runs again anyway.
  hostDigests: { retryLimit: 1, expireInSeconds: 120 },
  // The idempotency key makes a retry send one email; the throttle bounds requests.
  spaceEmail: { retryLimit: 5, retryDelay: 10, retryBackoff: true, expireInSeconds: 120 },
  // The cron fan-out; the next slot runs again anyway.
  safetyAlerts: { retryLimit: 1, expireInSeconds: 120 },
  // The cron fan-out; the next slot runs again anyway. Up to three searches per due space need
  // more headroom than 120 s at worst.
  dailyTips: { retryLimit: 1, expireInSeconds: 300 },
  // One run at a time; the next run repairs anything a failed one left.
  reconcile: { policy: 'singleton', retryLimit: 1, expireInSeconds: 600 },
  // Weekly; the dedupe key makes a retry add nothing.
  clusterFallbacks: { retryLimit: 2, retryDelay: 60, expireInSeconds: 300 },
  // One import per admin click; a crash leaves the run 'running' until it goes stale and the admin
  // imports again.
  importOpenData: { retryLimit: 0, expireInSeconds: 900 },
  // One drafting task each; a failure is a code on the task, and the SDK already retries
  // transient model errors, so a pg-boss retry would spend model credit twice.
  draftPlace: { retryLimit: 0, expireInSeconds: 300 },
  refreshCatalog: { retryLimit: 0, expireInSeconds: 300 },
  // The daily run; the next day's run picks up what a failure left.
  retention: { retryLimit: 1, expireInSeconds: 900 },
};

/**
 * Runs pg-boss's SQL through a Drizzle executor, so a job insert commits or rolls back with the
 * caller's transaction. pg-boss writes `$1`-style parameters; Drizzle wants an `SQL` object.
 */
export function pgBossExecutor(tx: Executor): BossDb {
  return {
    async executeSql(text, values = []) {
      const parts = text.split(/\$(\d+)/g);
      const chunks: SQLChunk[] = [];
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i] ?? '';
        chunks.push(i % 2 === 0 ? sql.raw(part) : sql.param(values[Number(part) - 1]));
      }
      const result = await tx.execute(sql.join(chunks));
      return { rows: result.rows };
    },
  };
}

/** A UUID derived from `key` (sha256, v5 layout), so the same key always names the same job. */
export function uuidFrom(key: string): string {
  const bytes = createHash('sha256').update(key).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface JobQueue {
  /** Inserts a job inside `tx`. A job whose `id` already exists is ignored. */
  send(
    name: QueueName,
    data: object,
    tx: Executor,
    options?: { id?: string; startAfter?: Date },
  ): Promise<void>;
  /** Sends `data` to every queue subscribed to `event`, inside `tx`. */
  publish(event: string, data: object, tx: Executor): Promise<void>;
}

export function createJobQueue(boss: PgBoss): JobQueue {
  return {
    async send(name, data, tx, options = {}) {
      await boss.send(name, data, { ...options, db: pgBossExecutor(tx) });
    },
    async publish(event, data, tx) {
      await boss.publish(event, data, { db: pgBossExecutor(tx) });
    },
  };
}

export async function ensureQueues(boss: PgBoss): Promise<void> {
  for (const [key, name] of Object.entries(QUEUES)) {
    await boss.createQueue(name, QUEUE_OPTIONS[key as keyof typeof QUEUES]);
  }
}
