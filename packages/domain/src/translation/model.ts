import Anthropic, { type ClientOptions } from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { Egress } from '@fetivi/egress';
import { type ModelUsage, usageOf } from '../metrics/usage';
import {
  buildUserMessage,
  TRANSLATION_MODEL_ID,
  TRANSLATION_SYSTEM_PROMPT,
  TranslationOutput,
  type TranslationOutputData,
} from './prompt';
import type { BlockText } from './structure';

export type ModelResult =
  | { ok: true; output: TranslationOutputData }
  | { ok: false; error: 'model-error' | 'not-configured'; detail: string };

/** The seam the job calls; tests replace it with a scripted stub. */
export interface TranslationModel {
  translate(source: BlockText): Promise<ModelResult>;
}

/**
 * Sonnet 5.5 with structured output, as measured in spike S6. Streaming, because outputs reach
 * 14k tokens and 86 s. No refusal fallbacks: every output comes from the one measured model.
 */
export function createAnthropicTranslationModel(opts: {
  apiKey: string | undefined;
  fetch: Egress['fetch'];
  /** Gets each successful response's tokens (a failed call has none and reports nothing). */
  onUsage?: (usage: ModelUsage) => void;
}): TranslationModel {
  const { apiKey } = opts;
  if (!apiKey) {
    return {
      translate: async () => ({
        ok: false,
        error: 'not-configured',
        detail: 'ANTHROPIC_API_KEY is not set',
      }),
    };
  }
  // The SDK only ever passes a URL string, which the egress fetch accepts.
  const client = new Anthropic({
    apiKey,
    fetch: opts.fetch as ClientOptions['fetch'],
    maxRetries: 3,
  });

  return {
    async translate(source) {
      try {
        const message = await client.messages
          .stream({
            model: TRANSLATION_MODEL_ID,
            max_tokens: 32000,
            system: TRANSLATION_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: buildUserMessage(source) }],
            output_config: { effort: 'high', format: zodOutputFormat(TranslationOutput) },
          })
          .finalMessage();
        opts.onUsage?.(usageOf(TRANSLATION_MODEL_ID, message.usage));
        if (message.stop_reason !== 'end_turn') {
          return { ok: false, error: 'model-error', detail: `stop_reason ${message.stop_reason}` };
        }
        if (message.parsed_output == null) {
          return { ok: false, error: 'model-error', detail: 'no parsed output' };
        }
        return { ok: true, output: message.parsed_output };
      } catch (error) {
        // API, connection and output-parsing errors; anything else is a bug and is rethrown.
        if (error instanceof Anthropic.AnthropicError) {
          const status = error instanceof Anthropic.APIError ? `${error.status ?? '-'} ` : '';
          return { ok: false, error: 'model-error', detail: `${status}${error.message}` };
        }
        throw error;
      }
    },
  };
}
