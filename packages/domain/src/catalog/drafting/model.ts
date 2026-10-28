import Anthropic, { type ClientOptions } from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { Egress } from '@fetivi/egress';
import { type ModelUsage, usageOf } from '../../metrics/usage';
import { buildDraftingMessage, DRAFTING_SYSTEM_PROMPT, type DraftingInput } from './prompt';
import { DraftExtraction, type DraftExtractionData } from './schema';
import { DRAFTING_LIMITS, DRAFTING_MODEL_ID } from './vocabulary';

export type DraftingModelResult =
  | { ok: true; output: DraftExtractionData }
  | { ok: false; error: 'model-error' | 'not-configured'; detail: string };

/** The seam the drafting pipeline calls; tests replace it with a scripted stub. */
export interface DraftingModel {
  extract(input: DraftingInput): Promise<DraftingModelResult>;
}

/**
 * Haiku 5.5 with structured output (architecture §4.1): the call only lifts stated facts off a
 * few pages, so the fast model at low effort is enough. `detail` carries codes and statuses only,
 * never page text or model output.
 */
export function createAnthropicDraftingModel(opts: {
  apiKey: string | undefined;
  fetch: Egress['fetch'];
  /** Gets each successful response's tokens (a failed call has none and reports nothing). */
  onUsage?: (usage: ModelUsage) => void;
}): DraftingModel {
  const { apiKey } = opts;
  if (!apiKey) {
    return {
      extract: async () => ({
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
    async extract(input) {
      try {
        const message = await client.messages
          .stream({
            model: DRAFTING_MODEL_ID,
            max_tokens: DRAFTING_LIMITS.maxOutputTokens,
            system: DRAFTING_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: buildDraftingMessage(input) }],
            output_config: { effort: 'low', format: zodOutputFormat(DraftExtraction) },
          })
          .finalMessage();
        opts.onUsage?.(usageOf(DRAFTING_MODEL_ID, message.usage));
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
          const status = error instanceof Anthropic.APIError ? String(error.status ?? '-') : '-';
          return { ok: false, error: 'model-error', detail: `${error.name} ${status}` };
        }
        throw error;
      }
    },
  };
}
