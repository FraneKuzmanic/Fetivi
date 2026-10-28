import Anthropic, { type ClientOptions } from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { Egress } from '@fetivi/egress';
import { type ModelUsage, usageOf } from '../../metrics/usage';
import { buildManualMessage, MANUAL_IMPORT_MODEL_ID, MANUAL_IMPORT_SYSTEM_PROMPT } from './prompt';
import { ManualExtraction, type ManualExtractionData } from './schema';

export type ManualModelResult =
  | { ok: true; output: ManualExtractionData }
  | { ok: false; error: 'model-error' | 'not-configured'; detail: string };

/** The seam the import route calls; tests replace it with a scripted stub. */
export interface ManualImportModel {
  extract(text: string): Promise<ManualModelResult>;
}

/**
 * Haiku 5.5 with structured output: the call maps the host's own wording and the host reviews
 * every draft, so the fast model is enough. Streaming, because a long manual gives a long output.
 */
export function createAnthropicManualImportModel(opts: {
  apiKey: string | undefined;
  fetch: Egress['fetch'];
  /** Gets each successful response's tokens (a failed call has none and reports nothing). */
  onUsage?: (usage: ModelUsage) => void;
}): ManualImportModel {
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
    async extract(text) {
      try {
        const message = await client.messages
          .stream({
            model: MANUAL_IMPORT_MODEL_ID,
            max_tokens: 32000,
            system: MANUAL_IMPORT_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: buildManualMessage(text) }],
            output_config: { effort: 'medium', format: zodOutputFormat(ManualExtraction) },
          })
          .finalMessage();
        opts.onUsage?.(usageOf(MANUAL_IMPORT_MODEL_ID, message.usage));
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
