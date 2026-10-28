import { BACKOFFICE_LANGUAGES, type BackofficeLanguage } from '@fetivi/domain/vocabulary';

export function isBackofficeLanguage(value: unknown): value is BackofficeLanguage {
  return typeof value === 'string' && (BACKOFFICE_LANGUAGES as readonly string[]).includes(value);
}

/** The browser's languages in preference order; none outside a browser. */
export const navigatorLanguages = (): readonly string[] =>
  typeof navigator === 'undefined' ? [] : (navigator.languages ?? []);

/** Croatian only when the browser's first language is Croatian ('hr', 'hr-HR'), else English. */
export function pickBrowserLanguage(languages: readonly string[]): BackofficeLanguage {
  const primary = languages[0]?.split('-')[0]?.toLowerCase();
  return primary === 'hr' ? 'hr' : 'en';
}
