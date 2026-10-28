import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDb } from '../db/client';
import { modelUsage, turnMetrics } from '../db/schema/metrics';
import { createTestDatabase, type TestDatabase } from '../testing';
import { modelUsageEstimate, recordModelUsage, type UseEstimate, usageRecorder } from './usage';
import type { ModelUse } from './vocabulary';

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb?.drop();
});

const NOW = new Date('2026-10-15T12:00:00Z');
const tokens = (input: number, output = 0, cacheRead = 0, cacheWrite = 0) => ({
  inputTokens: input,
  outputTokens: output,
  cacheReadTokens: cacheRead,
  cacheWriteTokens: cacheWrite,
});

const call = (use: ModelUse, model: string, at: string, t: ReturnType<typeof tokens>) =>
  recordModelUsage(testDb.db, use, { model, ...t }, new Date(at));

const turn = (at: string, t: ReturnType<typeof tokens>, model = 'claude-sonnet-5-5') =>
  testDb.db.insert(turnMetrics).values({
    conversationId: randomUUID(),
    model,
    startedAt: new Date(at),
    wallMs: 1000,
    mcpMs: 100,
    steps: 2,
    toolCalls: 1,
    toolNames: ['search_places'],
    ...t,
  });

const row = (rows: UseEstimate[], use: UseEstimate['use']) => rows.find((r) => r.use === use);

describe('modelUsageEstimate', () => {
  beforeAll(async () => {
    // Today (UTC).
    await turn('2026-10-15T08:00:00Z', tokens(1_000_000, 100_000)); // $2 + $1
    await call('translation', 'claude-sonnet-5-5', '2026-10-15T00:00:00Z', tokens(500_000)); // $1
    // Haiku, 150k prompt (input + cache read): long-prompt rate, $0.05 + $0.025 + $0.0025.
    await call(
      'drafting',
      'claude-haiku-5-5',
      '2026-10-15T09:00:00Z',
      tokens(100_000, 10_000, 50_000),
    );
    // Earlier this month.
    await turn('2026-10-14T23:59:59Z', tokens(0, 100_000)); // $1
    await call(
      'translation',
      'claude-sonnet-5-5',
      '2026-10-01T00:00:00Z',
      tokens(0, 0, 1_000_000, 1_000_000),
    ); // $2.60
    // Haiku, 50k prompt: standard rate, 0.05 × $0.10 = $0.005.
    await call('manual_import', 'claude-haiku-5-5', '2026-10-03T10:00:00Z', tokens(50_000));
    await call('handoff_translation', 'claude-unknown-1', '2026-10-05T10:00:00Z', tokens(1_000));
    // Last month and after now: never counted.
    await call('translation', 'claude-sonnet-5-5', '2026-09-30T23:59:59Z', tokens(9_000_000));
    await turn('2026-09-30T23:59:59Z', tokens(9_000_000));
    await call('translation', 'claude-sonnet-5-5', '2026-10-15T12:00:01Z', tokens(9_000_000));
  });

  it('sums today per use and prices it', async () => {
    const { today } = await modelUsageEstimate(testDb.db, NOW);
    expect(today.byUse.map((r) => r.use)).toEqual([
      'chat',
      'translation',
      'handoff_translation',
      'drafting',
      'manual_import',
    ]);
    expect(row(today.byUse, 'chat')).toMatchObject({ calls: 1, inputTokens: 1_000_000 });
    expect(row(today.byUse, 'chat')?.costUsd).toBeCloseTo(3, 6);
    expect(row(today.byUse, 'translation')?.costUsd).toBeCloseTo(1, 6);
    expect(row(today.byUse, 'drafting')?.costUsd).toBeCloseTo(0.0775, 6);
    expect(row(today.byUse, 'manual_import')).toMatchObject({ calls: 0, costUsd: 0 });
    expect(today.totalUsd).toBeCloseTo(4.0775, 6);
  });

  it('sums the month so far per use and prices it', async () => {
    const estimate = await modelUsageEstimate(testDb.db, NOW);
    const { month } = estimate;
    expect(row(month.byUse, 'chat')).toMatchObject({ calls: 2, outputTokens: 200_000 });
    expect(row(month.byUse, 'chat')?.costUsd).toBeCloseTo(4, 6);
    expect(row(month.byUse, 'translation')).toMatchObject({ calls: 2, cacheReadTokens: 1_000_000 });
    expect(row(month.byUse, 'translation')?.costUsd).toBeCloseTo(3.6, 6);
    expect(row(month.byUse, 'manual_import')?.costUsd).toBeCloseTo(0.005, 6);
    expect(month.totalUsd).toBeCloseTo(4 + 3.6 + 0.0775 + 0.005, 6);
    expect(estimate.pricesCheckedOn).toBe('2026-10-28');
  });

  it('counts calls on a model without a price apart', async () => {
    const estimate = await modelUsageEstimate(testDb.db, NOW);
    expect(row(estimate.month.byUse, 'handoff_translation')).toMatchObject({
      calls: 1,
      costUsd: 0,
    });
    expect(estimate.unpricedCalls).toBe(1);
  });

  it('returns zeros for a month with no rows', async () => {
    const estimate = await modelUsageEstimate(testDb.db, new Date('2026-08-20T10:00:00Z'));
    expect(estimate.month.totalUsd).toBe(0);
    expect(estimate.month.byUse.every((r) => r.calls === 0)).toBe(true);
    expect(estimate.unpricedCalls).toBe(0);
  });
});

describe('usageRecorder', () => {
  it('writes one row per response', async () => {
    const record = usageRecorder(
      testDb.db,
      'manual_import',
      () => new Date('2026-07-01T10:00:00Z'),
    );
    await record({ model: 'claude-haiku-5-5', ...tokens(10, 20, 30, 40) });
    const rows = await testDb.db.select().from(modelUsage);
    expect(rows.find((r) => r.at.toISOString() === '2026-07-01T10:00:00.000Z')).toMatchObject({
      use: 'manual_import',
      model: 'claude-haiku-5-5',
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 30,
      cacheWriteTokens: 40,
    });
  });

  it('logs and swallows a failed write', async () => {
    const { db, pool } = createDb('postgres://fetivi:fetivi@127.0.0.1:1/nowhere');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(
        usageRecorder(db, 'translation')({ model: 'claude-sonnet-5-5', ...tokens(1) }),
      ).resolves.toBeUndefined();
      expect(log).toHaveBeenCalledWith('model usage not recorded', expect.anything());
    } finally {
      log.mockRestore();
      await pool.end();
    }
  });
});
