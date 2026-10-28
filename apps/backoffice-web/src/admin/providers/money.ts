import type { PriceUnit } from '@fetivi/domain/offer-vocabulary';
import { i18next, localeOf } from '../../i18n';
import { currentLabels } from '../../i18n/useLabels';

// The API stores cents and basis points; the admin types euros and percentages.

export const centsFromEuros = (value: number | null): number | null =>
  value === null ? null : Math.round(value * 100);

export const eurosFromCents = (value: number | null): number | null =>
  value === null ? null : value / 100;

export const bpFromPercent = (value: number | null): number | null =>
  value === null ? null : Math.round(value * 100);

export const percentFromBp = (value: number): number => value / 100;

/** "€45.00 per person", or "Price on request" when the Provider names it. */
export function formatPrice(minor: number | null, currency: string, unit: PriceUnit): string {
  if (minor === null) return i18next.t('admin:price.onRequest');
  const amount = new Intl.NumberFormat(localeOf(i18next.language), {
    style: 'currency',
    currency,
  }).format(minor / 100);
  return i18next.t('admin:price.perUnit', { amount, unit: currentLabels().priceUnit[unit] });
}
