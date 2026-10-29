import type { LanguageModelUsage } from 'ai';

/**
 * One response's input tokens as stored: `input` is the uncached part only (Anthropic's raw
 * `input_tokens`), never the SDK's total, which already includes cache reads and writes.
 */
export function inputUsage(usage: LanguageModelUsage) {
  const cacheRead = usage.inputTokenDetails.cacheReadTokens ?? 0;
  const cacheWrite = usage.inputTokenDetails.cacheWriteTokens ?? 0;
  const input =
    usage.inputTokenDetails.noCacheTokens ??
    Math.max(0, (usage.inputTokens ?? 0) - cacheRead - cacheWrite);
  return { input, cacheRead, cacheWrite };
}
