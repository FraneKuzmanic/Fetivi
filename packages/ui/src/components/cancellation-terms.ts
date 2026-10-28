import type { PaymentMode } from '@fetivi/domain/offer-vocabulary';
import type { CancellationTermsPayload } from '../payloads';

/** The cancellation terms in the guest's words, per payment mode. */
export interface CancellationTermsLabels {
  /** No late charge: cancelling never costs anything. */
  freeAnyTime: string;
  freeUntil: (when: string) => string;
  /** Pay-direct, before the cutoff: what the provider may ask for afterwards. */
  directAfter: (percent: number) => string;
  directAfterFull: string;
  /** Pay-direct, after the cutoff. */
  directNow: (percent: number) => string;
  directNowFull: string;
  /** Pay-online, before the cutoff: what comes back afterwards. */
  onlineAfter: (refundPercent: number) => string;
  onlineAfterNone: string;
  /** Pay-online, after the cutoff. */
  onlineNow: (refundPercent: number) => string;
  onlineNowNone: string;
  /** Pay-online, nothing paid yet, before the cutoff: what cancelling costs afterwards. */
  chargeAfter: (percent: number) => string;
  chargeAfterFull: string;
  /** Pay-online, nothing paid yet, after the cutoff. */
  chargeNow: (percent: number) => string;
  chargeNowFull: string;
  dateTime: (date: string, startsAtLocal: string | null) => string;
}

/**
 * What cancelling costs, built from the snapshotted rules and never from the provider's text. A
 * guest reads "refund" only once they paid online (`paid`: authorized or captured); paying the
 * provider directly, Fetivi holds no money, and before an online payment there is nothing to give
 * back. Null when the draft has no terms (stored before they existed): no terms line then.
 */
export function cancellationTermsText(
  terms: CancellationTermsPayload | null,
  paymentMode: PaymentMode,
  paid: boolean,
  labels: CancellationTermsLabels,
): string | null {
  if (!terms) return null;
  const late = terms.lateChargePercent;
  if (late === 0) return labels.freeAnyTime;
  const until = labels.freeUntil(
    labels.dateTime(terms.freeUntilLocal.slice(0, 10), terms.freeUntilLocal),
  );
  if (paymentMode === 'direct') {
    if (terms.freeWindowPassed) return late === 100 ? labels.directNowFull : labels.directNow(late);
    return `${until} ${late === 100 ? labels.directAfterFull : labels.directAfter(late)}`;
  }
  if (!paid) {
    if (terms.freeWindowPassed) return late === 100 ? labels.chargeNowFull : labels.chargeNow(late);
    return `${until} ${late === 100 ? labels.chargeAfterFull : labels.chargeAfter(late)}`;
  }
  const back = 100 - late;
  if (terms.freeWindowPassed) return back === 0 ? labels.onlineNowNone : labels.onlineNow(back);
  return `${until} ${back === 0 ? labels.onlineAfterNone : labels.onlineAfter(back)}`;
}
