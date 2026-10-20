import { TranslationRuleError } from '@fetivi/domain';
import { HttpError } from './http-error';

const TRANSLATION_ERROR_STATUS: Record<TranslationRuleError['code'], number> = {
  'invalid-input': 400,
  'not-found': 404,
  'stale-revision': 409,
  'translation-not-failed': 409,
};

/** Runs a translation operation, turning its rule errors into HTTP errors. */
export async function withTranslationErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof TranslationRuleError) {
      throw new HttpError(TRANSLATION_ERROR_STATUS[error.code], error.code);
    }
    throw error;
  }
}
