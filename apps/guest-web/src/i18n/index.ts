import { GUEST_LANGUAGES, type GuestLanguage } from '@fetivi/domain/vocabulary';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { de } from './locales/de';
import { en } from './locales/en';
import { fr } from './locales/fr';
import { hr } from './locales/hr';
import { hu } from './locales/hu';
import { it } from './locales/it';
import { pl } from './locales/pl';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof en };
  }
}

export const locales = { en, hr, de, it, pl, hu, fr };

const resources = Object.fromEntries(
  Object.entries(locales).map(([code, translation]) => [code, { translation }]),
);

// Synchronous init: bundled resources, so the first render (and renderToString in tests) has strings.
void i18next.use(initReactI18next).init({
  resources,
  lng: 'en',
  fallbackLng: 'en',
  supportedLngs: [...GUEST_LANGUAGES],
  interpolation: { escapeValue: false },
  initAsync: false,
});

/** Switches the interface language and the document's `lang`. */
export function setLanguage(language: GuestLanguage): void {
  if (i18next.language !== language) void i18next.changeLanguage(language);
  if (typeof document !== 'undefined') document.documentElement.lang = language;
}

export { i18next };
