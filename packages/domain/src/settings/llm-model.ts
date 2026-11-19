import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createMistral } from '@ai-sdk/mistral';
import { createOpenAI } from '@ai-sdk/openai';
import type { Egress } from '@fetivi/egress';
import {
  AISDKError,
  jsonSchema,
  type LanguageModel,
  type LanguageModelUsage,
  NoOutputGeneratedError,
  Output,
  streamText,
} from 'ai';
import { z } from 'zod';
import type { ModelUsage } from '../metrics/usage';
import { type LlmConfig, type LlmSource, NOT_CONFIGURED_DETAIL } from './llm-key';
import type { LlmProvider } from './vocabulary';

// Every text-generating task goes through the AI SDK with the one model the admin set (71), so
// a task never knows which provider answers it.

type ModelMaker = (modelId: string) => LanguageModel;

function providerFor(config: LlmConfig, fetch: Egress['fetch']): ModelMaker {
  // The providers pass a URL and init only, which the egress fetch accepts.
  const settings = { apiKey: config.key, fetch: fetch as typeof globalThis.fetch };
  const makers: Record<LlmProvider, () => ModelMaker> = {
    anthropic: () => createAnthropic(settings).languageModel,
    openai: () => createOpenAI(settings).languageModel,
    google: () => createGoogleGenerativeAI(settings).languageModel,
    mistral: () => createMistral(settings).languageModel,
  };
  return makers[config.provider]();
}

/**
 * The language model for a setting: its model, or `defaultModel` (an Anthropic model id) when it
 * names none. The provider is rebuilt only when the provider or the key changes.
 */
export function languageModelCache(
  fetch: Egress['fetch'],
): (config: LlmConfig, defaultModel: string) => LanguageModel {
  let last: { provider: LlmProvider; key: string; make: ModelMaker } | undefined;
  return (config, defaultModel) => {
    if (last?.provider !== config.provider || last.key !== config.key) {
      last = { provider: config.provider, key: config.key, make: providerFor(config, fetch) };
    }
    return last.make(config.model ?? defaultModel);
  };
}

/** The model id a call ran on, for the usage record. */
export const modelIdOf = (model: LanguageModel): string =>
  typeof model === 'string' ? model : model.modelId;

/** One response's tokens as stored: input is the uncached part only, as Anthropic counts it. */
export function usageFromSdk(model: string, usage: LanguageModelUsage): ModelUsage {
  const cacheReadTokens = usage.inputTokenDetails.cacheReadTokens ?? 0;
  const cacheWriteTokens = usage.inputTokenDetails.cacheWriteTokens ?? 0;
  return {
    model,
    inputTokens:
      usage.inputTokenDetails.noCacheTokens ??
      Math.max(0, (usage.inputTokens ?? 0) - cacheReadTokens - cacheWriteTokens),
    outputTokens: usage.outputTokens ?? 0,
    cacheReadTokens,
    cacheWriteTokens,
  };
}

/**
 * The output schema as JSON Schema with shared parts as references, as Anthropic's own SDK sends
 * it: inlined, the manual import's repeated nullable fields pass Anthropic's limit of 16 union
 * parameters. The answer is still checked against the zod schema.
 */
function outputSchema<S extends z.ZodType>(schema: S) {
  return jsonSchema<z.infer<S>>(z.toJSONSchema(schema, { reused: 'ref' }) as never, {
    validate: (value) => {
      const parsed = schema.safeParse(value);
      return parsed.success
        ? { success: true, value: parsed.data }
        : { success: false, error: parsed.error };
    },
  });
}

export type StructuredResult<T> =
  | { ok: true; output: T }
  | { ok: false; error: 'model-error' | 'not-configured'; detail: string };

/**
 * One structured-output call on the model in the settings. Streamed, because a long manual or a
 * full translation gives a long output. `effort` and `defaultModel` apply to Anthropic only; other
 * providers ignore Anthropic's options. `detail` carries codes and statuses, never model output.
 */
export function createStructuredCaller(opts: {
  /** Resolved on every call, so a setting changed by the admin applies without a restart (68). */
  llm: LlmSource;
  fetch: Egress['fetch'];
  /** Gets each successful response's tokens (a failed call has none and reports nothing). */
  onUsage?: (usage: ModelUsage) => void;
}) {
  const modelFor = languageModelCache(opts.fetch);
  return async function call<S extends z.ZodType>(request: {
    defaultModel: string;
    effort: 'low' | 'medium' | 'high';
    maxOutputTokens: number;
    system: string;
    prompt: string;
    schema: S;
  }): Promise<StructuredResult<z.infer<S>>> {
    // Outside the try: a settings read failure is thrown (the job retries), not a model error.
    const config = await opts.llm();
    if (!config) return { ok: false, error: 'not-configured', detail: NOT_CONFIGURED_DETAIL };
    const model = modelFor(config, request.defaultModel);
    // streamText reports a failed request here and rejects its results with a generic error.
    let streamError: unknown;
    try {
      const result = streamText({
        onError: ({ error }) => {
          streamError = error;
        },
        model,
        system: request.system,
        prompt: request.prompt,
        maxOutputTokens: request.maxOutputTokens,
        output: Output.object({ schema: outputSchema(request.schema) }),
        providerOptions: {
          anthropic: { effort: request.effort, structuredOutputMode: 'outputFormat' },
        },
      });
      const [output, usage, finishReason] = await Promise.all([
        result.output,
        result.usage,
        result.finishReason,
      ]);
      opts.onUsage?.(usageFromSdk(modelIdOf(model), usage));
      if (finishReason !== 'stop') {
        return { ok: false, error: 'model-error', detail: `finish ${finishReason}` };
      }
      return { ok: true, output: output as z.infer<S> };
    } catch (thrown) {
      // API, connection and output-parsing errors; anything else is a bug and is rethrown.
      const error = streamError ?? thrown;
      if (NoOutputGeneratedError.isInstance(error)) {
        return { ok: false, error: 'model-error', detail: 'no parsed output' };
      }
      if (AISDKError.isInstance(error)) {
        const status = 'statusCode' in error ? `${String(error.statusCode ?? '-')} ` : '';
        return { ok: false, error: 'model-error', detail: `${status}${error.name}` };
      }
      throw error;
    }
  };
}
