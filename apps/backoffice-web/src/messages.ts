import { HOST_PLACE_LIMITS } from '@fetivi/domain/host-picks-vocabulary';
import { ApiError } from './api';
import { i18next } from './i18n';

/** An API error code in the interface language; any unknown code gets the generic message. */
export function messageFor(code: string): string {
  const key = `errors:${code}`;
  if (!i18next.exists(key)) return i18next.t('errors:internal');
  return i18next.t(key as 'errors:internal', { limit: HOST_PLACE_LIMITS.perProperty });
}

export function messageOf(error: unknown): string {
  return messageFor(error instanceof ApiError ? error.code : 'internal');
}
