import type { BackofficeLanguage } from '@fetivi/domain/vocabulary';
import { isBackofficeLanguage } from './browser-language';

const KEY = 'fetivi.language';

/** The language the signed-out pages last showed on this browser, if storage allows. */
export function storedLanguage(): BackofficeLanguage | null {
  try {
    const value = localStorage.getItem(KEY);
    return isBackofficeLanguage(value) ? value : null;
  } catch {
    return null;
  }
}

export function storeLanguage(language: BackofficeLanguage): void {
  try {
    localStorage.setItem(KEY, language);
  } catch {
    // Blocked storage: the signed-out pages fall back to the browser language.
  }
}
