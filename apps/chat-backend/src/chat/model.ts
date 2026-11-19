import type { AnthropicLanguageModelOptions } from '@ai-sdk/anthropic';
import { type LlmSource, languageModelCache } from '@fetivi/domain';
import type { Egress } from '@fetivi/egress';
import type { LanguageModel } from 'ai';

/** The chat's model when the setting names none (the environment key, or a key saved before 71). */
export const CHAT_MODEL_ID = 'claude-sonnet-5-5';
export const MAX_STEPS = 8;
export const MAX_OUTPUT_TOKENS = 2048;

/**
 * Adaptive thinking at low effort (architecture §4.1); the thinking text stays omitted. Sonnet
 * 5.5 rejects `budgetTokens` and `type: 'disabled'`, so neither is ever sent. The top-level
 * `cacheControl` is Anthropic's automatic breakpoint: it lands on the last block of every request,
 * so each step and the next turn read the earlier conversation from the cache (5-minute TTL, the
 * rate in prices.ts). With the system block's own breakpoint that is 2 of Anthropic's 4. Other
 * providers ignore these Anthropic options (71).
 */
export const CHAT_PROVIDER_OPTIONS = {
  anthropic: { thinking: { type: 'adaptive' }, effort: 'low', cacheControl: { type: 'ephemeral' } },
} satisfies { anthropic: AnthropicLanguageModelOptions };

/** The chat model to use now; null without a key (chat then answers 503). */
export type ChatModelSource = () => Promise<LanguageModel | null>;

/**
 * Resolves the setting per turn, so a key or model changed in the admin settings reaches the
 * chat without a restart (68, 71); the model object is reused while the setting stays the same.
 */
export function chatModelSource(llm: LlmSource, fetch: Egress['fetch']): ChatModelSource {
  const modelFor = languageModelCache(fetch);
  let last: { setting: string; model: LanguageModel } | undefined;
  return async () => {
    const config = await llm();
    if (!config) return null;
    const setting = `${config.provider}|${config.key}|${config.model ?? ''}`;
    if (last?.setting !== setting) last = { setting, model: modelFor(config, CHAT_MODEL_ID) };
    return last.model;
  };
}
