import type { ProposedTerms, ProviderLinkView } from '@fetivi/domain';
import { HHMM } from '../properties/schemas';

// New terms (36) the answering side proposes, checked against the view it was shown: the
// Provider's link form and the host's inbox (38) share this rule.

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type TermsError = 'date' | 'time' | 'price';

/**
 * The terms to propose, or the first field that is wrong. The date lies in the stay, the time is
 * 'HH:mm' or empty, and a price is required for a request-kind Order, a pay-online one without a
 * price, and Accept with price. Accept with price keeps the shown date and time.
 */
export function checkNewTerms(
  view: ProviderLinkView,
  input: { date?: string | undefined; time?: string | undefined; priceMinor?: number | undefined },
  priceOnly: boolean,
): ProposedTerms | TermsError {
  const date = priceOnly ? view.date : (input.date ?? '');
  if (!DATE.test(date) || date < view.stayFrom || date > view.stayTo) return 'date';
  const time = priceOnly ? (view.startTime ?? '') : (input.time ?? '');
  if (time !== '' && !HHMM.test(time)) return 'time';
  const { priceMinor } = input;
  if (priceMinor === undefined && (view.needsPrice || priceOnly)) return 'price';
  return { date, ...(time ? { time } : {}), ...(priceMinor !== undefined ? { priceMinor } : {}) };
}
