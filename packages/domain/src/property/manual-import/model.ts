import type { Egress } from '@fetivi/egress';
import type { ModelUsage } from '../../metrics/usage';
import type { LlmSource } from '../../settings/llm-key';
import { createStructuredCaller } from '../../settings/llm-model';
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
 * Structured output on the model in the settings; Haiku 5.5 by default, since the call maps the
 * host's own wording and the host reviews every draft. A long manual gives a long output.
 */
export function createManualImportModel(opts: {
  llm: LlmSource;
  fetch: Egress['fetch'];
  onUsage?: (usage: ModelUsage) => void;
}): ManualImportModel {
  const call = createStructuredCaller(opts);
  return {
    extract: (text) =>
      call({
        defaultModel: MANUAL_IMPORT_MODEL_ID,
        effort: 'medium',
        maxOutputTokens: 32000,
        system: MANUAL_IMPORT_SYSTEM_PROMPT,
        prompt: buildManualMessage(text),
        schema: ManualExtraction,
      }),
  };
}
