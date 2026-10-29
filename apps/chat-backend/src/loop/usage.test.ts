import type { LanguageModelUsage } from 'ai';
import { describe, expect, it } from 'vitest';
import { inputUsage } from './usage';

const usage = (
  inputTokens: number | undefined,
  details: Partial<LanguageModelUsage['inputTokenDetails']> = {},
): LanguageModelUsage => ({
  inputTokens,
  inputTokenDetails: {
    noCacheTokens: undefined,
    cacheReadTokens: undefined,
    cacheWriteTokens: undefined,
    ...details,
  },
  outputTokens: undefined,
  outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
  totalTokens: undefined,
});

describe('inputUsage', () => {
  it('takes the uncached input from the no-cache field', () => {
    // The measured 3-step turn of 2026-10-29: the SDK total counts the cache read again.
    expect(
      inputUsage(
        usage(93_834, { noCacheTokens: 30_990, cacheReadTokens: 62_844, cacheWriteTokens: 0 }),
      ),
    ).toEqual({ input: 30_990, cacheRead: 62_844, cacheWrite: 0 });
  });

  it('subtracts cache reads and writes from the total without the no-cache field', () => {
    expect(inputUsage(usage(1000, { cacheReadTokens: 600, cacheWriteTokens: 150 }))).toEqual({
      input: 250,
      cacheRead: 600,
      cacheWrite: 150,
    });
  });

  it('keeps the total as uncached input when no cache details came back', () => {
    expect(inputUsage(usage(1000))).toEqual({ input: 1000, cacheRead: 0, cacheWrite: 0 });
  });

  it('counts zero when the provider reports nothing', () => {
    expect(inputUsage(usage(undefined))).toEqual({ input: 0, cacheRead: 0, cacheWrite: 0 });
  });
});
