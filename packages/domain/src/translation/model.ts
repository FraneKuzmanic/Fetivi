import type { Egress } from '@fetivi/egress';
import type { ModelUsage } from '../metrics/usage';
import type { LlmSource } from '../settings/llm-key';
import { createStructuredCaller } from '../settings/llm-model';
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
 * Structured output on the model in the settings; Sonnet 5.5 at high effort by default, as
 * measured in spike S6. Outputs reach 14k tokens and 86 s, hence the large output limit.
 */
export function createTranslationModel(opts: {
  llm: LlmSource;
  fetch: Egress['fetch'];
  onUsage?: (usage: ModelUsage) => void;
}): TranslationModel {
  const call = createStructuredCaller(opts);
  return {
    translate: (source) =>
      call({
        defaultModel: TRANSLATION_MODEL_ID,
        effort: 'high',
        maxOutputTokens: 32000,
        system: TRANSLATION_SYSTEM_PROMPT,
        prompt: buildUserMessage(source),
        schema: TranslationOutput,
      }),
  };
}
