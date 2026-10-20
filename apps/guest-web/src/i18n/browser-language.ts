import { GUEST_LANGUAGES, type GuestLanguage } from '@fetivi/domain/vocabulary';

const isGuestLanguage = (code: string): code is GuestLanguage =>
  (GUEST_LANGUAGES as readonly string[]).includes(code);

/** The first browser language we speak ('de-AT' counts as 'de'), else English. */
export function pickBrowserLanguage(languages: readonly string[]): GuestLanguage {
  for (const tag of languages) {
    const primary = tag.split('-')[0]?.toLowerCase() ?? '';
    if (isGuestLanguage(primary)) return primary;
  }
  return 'en';
}

export function isLanguage(value: unknown): value is GuestLanguage {
  return typeof value === 'string' && isGuestLanguage(value);
}
