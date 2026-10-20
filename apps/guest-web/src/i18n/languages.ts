import type { GuestLanguage } from '@fetivi/domain/vocabulary';

/** Each language under its own name. Rendered with `lang={code}`. */
export const LANGUAGE_NAMES: Record<GuestLanguage, string> = {
  en: 'English',
  hr: 'Hrvatski',
  de: 'Deutsch',
  it: 'Italiano',
  pl: 'Polski',
  hu: 'Magyar',
  fr: 'Français',
};
