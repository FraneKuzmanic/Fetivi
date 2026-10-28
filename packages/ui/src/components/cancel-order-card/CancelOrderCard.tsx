import { CalendarX } from '@phosphor-icons/react';
import { useId } from 'react';
import type { CancelOrderDraftPayload } from '../../payloads';
import { type CancellationTermsLabels, cancellationTermsText } from '../cancellation-terms';

export interface CancelOrderLabels {
  heading: string;
  offer: string;
  when: string;
  quantity: string;
  dateTime: (date: string, startsAtLocal: string | null) => string;
  /** Captured, after the cutoff: part of the price comes back. */
  refundPartial: (amount: string, percent: number) => string;
  /** Before the cutoff, or an authorization that is released: everything comes back. */
  refundFull: (amount: string) => string;
  /** The policy gives nothing back at this point. */
  refundNone: string;
  /** Pay-online, nothing paid yet. */
  refundNotPaid: string;
  /** Pay-direct, before the cutoff (or under no late charge). */
  cancelFree: string;
  /** While cancelling is still free: until when. */
  freeUntil: (when: string) => string;
  policy: string;
  terms: CancellationTermsLabels;
  confirm: string;
  keep: string;
  sending: string;
}

const money = (minor: number, currency: string, language: string) =>
  new Intl.NumberFormat(language, { style: 'currency', currency }).format(minor / 100);

/**
 * What the cancel costs or gives back, in the guest's words; every amount comes from the stored
 * draft. Pay-direct never speaks of a refund: free before the cutoff, the provider's terms after.
 */
function refundLine(draft: CancelOrderDraftPayload, labels: CancelOrderLabels): string | null {
  if (draft.paymentMode === 'direct') {
    const terms = draft.cancellation;
    if (!terms) return null;
    if (!terms.freeWindowPassed || terms.lateChargePercent === 0) return labels.cancelFree;
    return terms.lateChargePercent === 100
      ? labels.terms.directNowFull
      : labels.terms.directNow(terms.lateChargePercent);
  }
  if (draft.refundMinor === null) return labels.refundNotPaid;
  if (draft.refundMinor === 0) return labels.refundNone;
  const amount = money(draft.refundMinor, draft.currency, draft.language);
  if (draft.refundPercent === 100) return labels.refundFull(amount);
  return labels.refundPartial(amount, draft.refundPercent ?? 0);
}

/**
 * The cancel card: the Order, what cancelling costs or gives back now and the terms, all from the
 * snapshotted rules.
 * Nothing changes before Cancel booking. The card never takes focus on its own.
 */
export function CancelOrderCard({
  draft,
  state,
  onConfirm,
  onKeep,
  labels,
}: {
  draft: CancelOrderDraftPayload;
  state: 'open' | 'sending';
  onConfirm: () => void;
  onKeep: () => void;
  labels: CancelOrderLabels;
}) {
  const headingId = `${useId()}-heading`;
  const sending = state === 'sending';
  // A cutoff is only set for a captured Order, and a full refund means it is still ahead. The
  // terms below name the same date, so this line is only for drafts stored without them.
  const freeUntil =
    !draft.cancellation && draft.freeUntilLocal && draft.refundPercent === 100
      ? labels.freeUntil(labels.dateTime(draft.freeUntilLocal.slice(0, 10), draft.freeUntilLocal))
      : null;

  const refund = refundLine(draft, labels);
  const paid = draft.paymentStatus === 'authorized' || draft.paymentStatus === 'captured';
  // Paying online with nothing paid yet, cancelling costs nothing: the terms would contradict it.
  const terms =
    draft.paymentMode === 'online' && !paid
      ? null
      : cancellationTermsText(draft.cancellation, draft.paymentMode, paid, labels.terms);

  const facts: [string, string][] = [
    [labels.offer, draft.offerTitle],
    [labels.when, labels.dateTime(draft.date, draft.startsAtLocal)],
    [labels.quantity, String(draft.quantity)],
  ];

  return (
    <section className="fv-confirm fv-cancel" aria-labelledby={headingId}>
      <h3 id={headingId} className="fv-confirm-heading">
        {labels.heading}
      </h3>
      <dl className="fv-confirm-facts">
        {facts.map(([term, value]) => (
          <div key={term}>
            <dt>{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {(refund || freeUntil) && (
        <div className="fv-cancel-refund">
          {refund && <p className="fv-cancel-amount">{refund}</p>}
          {freeUntil && <p className="fv-confirm-note">{freeUntil}</p>}
        </div>
      )}
      {/* After a pay-direct cutoff the line above already says it. */}
      {terms && terms !== refund && (
        <div className="fv-cancel-policy">
          <h4>{labels.policy}</h4>
          <p>{terms}</p>
        </div>
      )}
      <div className="fv-confirm-actions">
        <button
          type="button"
          className="fv-confirm-yes fv-cancel-yes"
          disabled={sending}
          onClick={onConfirm}
        >
          <CalendarX size={18} weight="bold" aria-hidden="true" />
          {labels.confirm}
        </button>
        <button type="button" className="fv-confirm-no" disabled={sending} onClick={onKeep}>
          {labels.keep}
        </button>
      </div>
      {sending && (
        <p role="status" className="fv-confirm-sending">
          {labels.sending}
        </p>
      )}
    </section>
  );
}
