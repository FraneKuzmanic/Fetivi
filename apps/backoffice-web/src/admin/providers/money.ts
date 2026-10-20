import type { PriceUnit } from '@fetivi/domain/offer-vocabulary';
import { PRICE_UNIT_LABELS } from '../../forms/labels';

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
  if (minor === null) return 'Price on request';
  const amount = new Intl.NumberFormat('en', { style: 'currency', currency }).format(minor / 100);
  return `${amount} ${PRICE_UNIT_LABELS[unit]}`;
}
