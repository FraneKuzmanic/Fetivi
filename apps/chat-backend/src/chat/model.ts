import {
  type AnthropicLanguageModelOptions,
  type AnthropicProviderSettings,
  createAnthropic,
} from '@ai-sdk/anthropic';
import type { Egress } from '@fetivi/egress';
import type { LanguageModel } from 'ai';

export const CHAT_MODEL_ID = 'claude-sonnet-5-5';
export const MAX_STEPS = 8;
export const MAX_OUTPUT_TOKENS = 2048;

/**
 * Adaptive thinking at low effort (architecture §4.1); the thinking text stays omitted. Sonnet
 * 5.5 rejects `budgetTokens` and `type: 'disabled'`, so neither is ever sent.
 */
export const CHAT_PROVIDER_OPTIONS = {
  anthropic: { thinking: { type: 'adaptive' }, effort: 'low' },
} satisfies { anthropic: AnthropicLanguageModelOptions };

/** Sonnet 5.5 through egress; null without an API key (chat then answers 503). */
export function createChatModel(opts: {
  apiKey: string | undefined;
  fetch: Egress['fetch'];
}): LanguageModel | null {
  if (!opts.apiKey) return null;
  // The provider passes a URL and init only, which the egress fetch accepts.
  return createAnthropic({
    apiKey: opts.apiKey,
    fetch: opts.fetch as AnthropicProviderSettings['fetch'],
  }).languageModel(CHAT_MODEL_ID);
}
