import { and, count, gte, lte, type SQL, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type { Executor } from '../db/client';
import { modelUsage, turnMetrics } from '../db/schema/metrics';
import { costUsd, MODEL_PRICES, PRICES_CHECKED_ON, type TokenCounts } from './prices';
import { type ModelUse, USAGE_ESTIMATE_USES, type UsageEstimateUse } from './vocabulary';

/** The tokens of one Anthropic response. */
export interface ModelUsage extends TokenCounts {
  model: string;
}

/** The `usage` object of an Anthropic SDK message (cache counts may be missing or null). */
export interface SdkUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export function usageOf(model: string, usage: SdkUsage): ModelUsage {
  return {
    model,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  };
}

/** Writes one `model_usage` row. */
export async function recordModelUsage(
  db: Executor,
  use: ModelUse,
  usage: ModelUsage,
  at: Date,
): Promise<void> {
  await db.insert(modelUsage).values({ ...usage, use, at });
}

/**
 * The `onUsage` callback an Anthropic adapter takes: records each response's tokens. A failed
 * write is logged and never fails the model call (a missing estimate row beats a failed job).
 */
export function usageRecorder(
  db: Executor,
  use: ModelUse,
  now: () => Date = () => new Date(),
): (usage: ModelUsage) => Promise<void> {
  return (usage) =>
    recordModelUsage(db, use, usage, now()).catch((error: unknown) => {
      console.error('model usage not recorded', error);
    });
}

export interface UseEstimate extends TokenCounts {
  use: UsageEstimateUse;
  calls: number;
  costUsd: number;
}

export interface PeriodEstimate {
  totalUsd: number;
  byUse: UseEstimate[];
}

export interface UsageEstimate {
  pricesCheckedOn: string;
  today: PeriodEstimate;
  month: PeriodEstimate;
  /** Calls or chat turns on a model missing from the price table, left out of the costs. */
  unpricedCalls: number;
}

interface Group extends TokenCounts {
  use: UsageEstimateUse;
  model: string;
  longPrompt: boolean;
  calls: number;
}

const tokenSums = (t: typeof modelUsage | typeof turnMetrics) => ({
  inputTokens: sql`sum(${t.inputTokens})`.mapWith(Number),
  outputTokens: sql`sum(${t.outputTokens})`.mapWith(Number),
  cacheReadTokens: sql`sum(${t.cacheReadTokens})`.mapWith(Number),
  cacheWriteTokens: sql`sum(${t.cacheWriteTokens})`.mapWith(Number),
  calls: count(),
});

/**
 * Whether a `model_usage` row was billed at its model's long-prompt rate. Built from the constant
 * price table as raw SQL so the select and the group by are the same expression.
 */
function longPromptExpr(): SQL<boolean> {
  const prompt = 'input_tokens + cache_read_tokens + cache_write_tokens';
  const whens = Object.entries(MODEL_PRICES)
    .filter(([, p]) => p.longPrompt)
    .map(([model, p]) => `when "model" = '${model}' then ${prompt} > ${p.longPrompt?.overTokens}`);
  return sql.raw(`case ${whens.join(' ')} else false end`) as SQL<boolean>;
}

async function groupsBetween(db: Executor, from: Date, to: Date): Promise<Group[]> {
  const long = longPromptExpr();
  const calls = await db
    .select({
      use: modelUsage.use,
      model: modelUsage.model,
      longPrompt: long,
      ...tokenSums(modelUsage),
    })
    .from(modelUsage)
    .where(and(gte(modelUsage.at, from), lte(modelUsage.at, to)))
    .groupBy(modelUsage.use, modelUsage.model, long);
  const turns = await db
    .select({ model: turnMetrics.model, ...tokenSums(turnMetrics) })
    .from(turnMetrics)
    .where(and(gte(turnMetrics.startedAt, from), lte(turnMetrics.startedAt, to)))
    .groupBy(turnMetrics.model);
  // A chat turn sums several requests, so no single-request rate tier applies to it.
  return [...calls, ...turns.map((t) => ({ ...t, use: 'chat' as const, longPrompt: false }))];
}

function priced(groups: Group[]): { period: PeriodEstimate; unpricedCalls: number } {
  const byUse = USAGE_ESTIMATE_USES.map(
    (use): UseEstimate => ({
      use,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
    }),
  );
  let unpricedCalls = 0;
  for (const g of groups) {
    const row = byUse.find((r) => r.use === g.use);
    if (!row) continue;
    row.calls += g.calls;
    row.inputTokens += g.inputTokens;
    row.outputTokens += g.outputTokens;
    row.cacheReadTokens += g.cacheReadTokens;
    row.cacheWriteTokens += g.cacheWriteTokens;
    const cost = costUsd(g.model, g, g.longPrompt);
    if (cost === null) unpricedCalls += g.calls;
    else row.costUsd += cost;
  }
  return {
    period: { totalUsd: byUse.reduce((sum, r) => sum + r.costUsd, 0), byUse },
    unpricedCalls,
  };
}

/**
 * The estimated Anthropic spend for today and this month so far (UTC): recorded tokens × list
 * prices, split by use. An estimate, not a bill: failed calls record nothing.
 */
export async function modelUsageEstimate(db: Executor, now: Date): Promise<UsageEstimate> {
  const utc = DateTime.fromJSDate(now, { zone: 'utc' });
  const today = priced(await groupsBetween(db, utc.startOf('day').toJSDate(), now));
  const month = priced(await groupsBetween(db, utc.startOf('month').toJSDate(), now));
  return {
    pricesCheckedOn: PRICES_CHECKED_ON,
    today: today.period,
    month: month.period,
    unpricedCalls: month.unpricedCalls,
  };
}
