import { createHash } from 'node:crypto';
import { type SQLChunk, sql } from 'drizzle-orm';
import type { Db as BossDb, PgBoss, Queue } from 'pg-boss';
import type { Executor } from '../db/client';

export const QUEUES = { translateBlock: 'translate-block' } as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const EVENTS = { unitProjectionInvalidated: 'unit-projection-invalidated' } as const;

export const QUEUE_OPTIONS: Record<keyof typeof QUEUES, Omit<Queue, 'name'>> = {
  // pg-boss retries cover crashes and DB errors; model failures end as a visible 'failed' status.
  translateBlock: { retryLimit: 2, retryDelay: 30, retryBackoff: true, expireInSeconds: 600 },
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
  send(name: QueueName, data: object, tx: Executor, options?: { id?: string }): Promise<void>;
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
