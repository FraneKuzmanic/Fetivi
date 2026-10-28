/**
 * Anthropic list prices in USD per million tokens, the one price table for the usage estimate.
 * Checked on PRICES_CHECKED_ON at https://platform.claude.com/docs/en/about-claude/pricing
 * (cache writes are the 5-minute rate, the only one Fetivi uses).
 */
export const PRICES_CHECKED_ON = '2026-10-28';

export interface TokenPrices {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

interface ModelPrices {
  standard: TokenPrices;
  /** A higher rate for a request whose prompt (input + cache read + cache write) is over `overTokens`. */
  longPrompt?: TokenPrices & { overTokens: number };
}

export const MODEL_PRICES: Record<string, ModelPrices> = {
  'claude-sonnet-5-5': { standard: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 } },
  'claude-haiku-5-5': {
    standard: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
    longPrompt: {
      overTokens: 100_000,
      input: 0.5,
      output: 2.5,
      cacheRead: 0.05,
      cacheWrite: 0.625,
    },
  },
};

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/**
 * The list price in USD of `tokens` on `model`, or null for a model missing from the table.
 * `longPrompt` picks the long-prompt rate; the caller decides it per request.
 */
export function costUsd(model: string, tokens: TokenCounts, longPrompt = false): number | null {
  const prices = MODEL_PRICES[model];
  if (!prices) return null;
  const rate = (longPrompt && prices.longPrompt) || prices.standard;
  return (
    (tokens.inputTokens * rate.input +
      tokens.outputTokens * rate.output +
      tokens.cacheReadTokens * rate.cacheRead +
      tokens.cacheWriteTokens * rate.cacheWrite) /
    1_000_000
  );
}
