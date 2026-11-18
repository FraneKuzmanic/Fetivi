import { GUEST_LANGUAGES, type GuestLanguage } from '@fetivi/domain/vocabulary';

const isGuestLanguage = (code: string): code is GuestLanguage =>
  (GUEST_LANGUAGES as readonly string[]).includes(code);

export function isLanguage(value: unknown): value is GuestLanguage {
  return typeof value === 'string' && isGuestLanguage(value);
}
