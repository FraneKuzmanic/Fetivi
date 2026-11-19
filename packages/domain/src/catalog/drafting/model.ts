import type { Egress } from '@fetivi/egress';
import type { ModelUsage } from '../../metrics/usage';
import type { LlmSource } from '../../settings/llm-key';
import { createStructuredCaller } from '../../settings/llm-model';
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
 * Structured output on the model in the settings; Haiku 5.5 at low effort by default
 * (architecture §4.1), since the call only lifts stated facts off a few pages. `detail` carries
 * codes and statuses only, never page text or model output.
 */
export function createDraftingModel(opts: {
  llm: LlmSource;
  fetch: Egress['fetch'];
  onUsage?: (usage: ModelUsage) => void;
}): DraftingModel {
  const call = createStructuredCaller(opts);
  return {
    extract: (input) =>
      call({
        defaultModel: DRAFTING_MODEL_ID,
        effort: 'low',
        maxOutputTokens: DRAFTING_LIMITS.maxOutputTokens,
        system: DRAFTING_SYSTEM_PROMPT,
        prompt: buildDraftingMessage(input),
        schema: DraftExtraction,
      }),
  };
}
