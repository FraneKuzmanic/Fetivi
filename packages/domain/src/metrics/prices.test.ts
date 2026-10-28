import { describe, expect, it } from 'vitest';
import { DRAFTING_MODEL_ID } from '../catalog/drafting/vocabulary';
import { MANUAL_IMPORT_MODEL_ID } from '../property/manual-import/prompt';
import { TRANSLATION_MODEL_ID } from '../translation/prompt';
import { costUsd, MODEL_PRICES } from './prices';

const none = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

describe('costUsd', () => {
  it('prices a million Sonnet input tokens at $2', () => {
    expect(costUsd('claude-sonnet-5-5', { ...none, inputTokens: 1_000_000 })).toBe(2);
  });

  it('adds every token kind at its own rate', () => {
    const cost = costUsd('claude-sonnet-5-5', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(2 + 10 + 0.1 + 2.5, 10);
  });

  it('uses the Haiku long-prompt rate when asked', () => {
    const tokens = { ...none, inputTokens: 150_000, outputTokens: 1_000 };
    expect(costUsd('claude-haiku-5-5', tokens)).toBeCloseTo(0.015 + 0.0005, 10);
    expect(costUsd('claude-haiku-5-5', tokens, true)).toBeCloseTo(0.075 + 0.0025, 10);
  });

  it('ignores the long-prompt flag for a model without that rate', () => {
    expect(costUsd('claude-sonnet-5-5', { ...none, inputTokens: 1_000_000 }, true)).toBe(2);
  });

  it('returns null for a model missing from the table', () => {
    expect(costUsd('claude-unknown-1', { ...none, inputTokens: 10 })).toBeNull();
  });

  it('has a price for every model Fetivi calls', () => {
    // Guest chat: CHAT_MODEL_ID in apps/chat-backend/src/chat/model.ts.
    const ids = [
      'claude-sonnet-5-5',
      TRANSLATION_MODEL_ID,
      DRAFTING_MODEL_ID,
      MANUAL_IMPORT_MODEL_ID,
    ];
    for (const id of ids) expect(MODEL_PRICES[id], id).toBeDefined();
  });
});
