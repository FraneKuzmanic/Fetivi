import type { BackofficeLanguage } from '@fetivi/domain/vocabulary';

/** Each language under its own name. Rendered with `lang={code}`. */
export const LANGUAGE_NAMES: Record<BackofficeLanguage, string> = {
  hr: 'Hrvatski',
  en: 'English',
};
