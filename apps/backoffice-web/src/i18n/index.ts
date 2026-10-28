import { BACKOFFICE_LANGUAGES, type BackofficeLanguage } from '@fetivi/domain/vocabulary';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { isBackofficeLanguage, navigatorLanguages, pickBrowserLanguage } from './browser-language';
import { en } from './locales/en';
import { hr } from './locales/hr';
import { storedLanguage } from './stored-language';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: typeof en;
  }
}

export const locales = { en, hr };

/** Before anyone signs in: the signed-out switch's last choice, else the browser's language. */
const initial = storedLanguage() ?? pickBrowserLanguage(navigatorLanguages());

// Synchronous init: bundled resources, so the first render (and tests) has strings.
void i18next.use(initReactI18next).init({
  resources: locales,
  lng: initial,
  fallbackLng: 'en',
  supportedLngs: [...BACKOFFICE_LANGUAGES],
  ns: Object.keys(en),
  defaultNS: 'common',
  interpolation: { escapeValue: false },
  initAsync: false,
});

/** Switches the interface language and the document's `lang`. */
export function setLanguage(language: BackofficeLanguage): void {
  if (i18next.language !== language) void i18next.changeLanguage(language);
  if (typeof document !== 'undefined') document.documentElement.lang = language;
}

setLanguage(initial);

/** The language the interface shows now. */
export function currentLanguage(): BackofficeLanguage {
  return isBackofficeLanguage(i18next.language) ? i18next.language : 'en';
}

/** The `Intl` locale for a back-office language: both day-first. */
export function localeOf(language: string): 'hr-HR' | 'en-GB' {
  return language === 'hr' ? 'hr-HR' : 'en-GB';
}

export { i18next };
