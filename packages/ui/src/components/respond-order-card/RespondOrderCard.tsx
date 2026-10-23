import { useId, useState } from 'react';
import type { RespondOrderDraftPayload } from '../../payloads';

export interface RespondOrderLabels {
  /** The heading per who proposed the terms. */
  heading: Record<RespondOrderDraftPayload['proposer'], string>;
  offer: string;
  when: string;
  quantity: string;
  price: string;
  /** Screen-reader prefix for the replaced value. */
  was: string;
  dateTime: (date: string, startsAtLocal: string | null) => string;
  answerBy: (when: string) => string;
  payOnline: string;
  payDirect: string;
  policy: string;
  accept: string;
  decline: string;
  notNow: string;
  declineQuestion: string;
  declineYes: string;
  back: string;
  sending: string;
}

const money = (minor: number, currency: string, language: string) =>
  new Intl.NumberFormat(language, { style: 'currency', currency }).format(minor / 100);

/** A value with the replaced one struck through before it, when they differ. */
function Changed({ now, was, wasLabel }: { now: string; was: string | null; wasLabel: string }) {
  if (was === null || was === now) return <>{now}</>;
  return (
    <>
      <del className="fv-respond-was">
        <span className="fv-visually-hidden">{wasLabel} </span>
        {was}
      </del>{' '}
      <ins className="fv-respond-now">{now}</ins>
    </>
  );
}

/**
 * The card for new terms the Provider (or the admin) proposed: what changed, by when to answer,
 * and how it is paid. Accept confirms them; Decline cancels the Order after one more tap; Not now
 * leaves it waiting. Nothing changes before a tap, and the card never takes focus on its own.
 */
export function RespondOrderCard({
  draft,
  state,
  onAnswer,
  onNotNow,
  labels,
}: {
  draft: RespondOrderDraftPayload;
  state: 'open' | 'sending';
  onAnswer: (answer: 'accept' | 'decline') => void;
  onNotNow: () => void;
  labels: RespondOrderLabels;
}) {
  const headingId = `${useId()}-heading`;
  const [declining, setDeclining] = useState(false);
  const sending = state === 'sending';
  const { previous } = draft;
  const price = (minor: number | null) =>
    minor === null ? null : money(minor, draft.currency, draft.language);

  return (
    <section className="fv-confirm fv-respond" aria-labelledby={headingId}>
      <h3 id={headingId} className="fv-confirm-heading">
        {labels.heading[draft.proposer]}
      </h3>
      <dl className="fv-confirm-facts">
        <div>
          <dt>{labels.offer}</dt>
          <dd>{draft.offerTitle}</dd>
        </div>
        <div>
          <dt>{labels.when}</dt>
          <dd>
            <Changed
              now={labels.dateTime(draft.date, draft.startsAtLocal)}
              was={labels.dateTime(previous.date, previous.startsAtLocal)}
              wasLabel={labels.was}
            />
          </dd>
        </div>
        <div>
          <dt>{labels.quantity}</dt>
          <dd>{draft.quantity}</dd>
        </div>
        {draft.priceMinor !== null && (
          <div>
            <dt>{labels.price}</dt>
            <dd>
              <Changed
                now={price(draft.priceMinor) ?? ''}
                was={price(previous.priceMinor)}
                wasLabel={labels.was}
              />
            </dd>
          </div>
        )}
      </dl>
      <div className="fv-cancel-refund">
        <p className="fv-cancel-amount">
          {labels.answerBy(
            labels.dateTime(draft.respondByLocal.slice(0, 10), draft.respondByLocal),
          )}
        </p>
        <p className="fv-confirm-note">
          {draft.paymentMode === 'online' ? labels.payOnline : labels.payDirect}
        </p>
      </div>
      <div className="fv-cancel-policy">
        <h4>{labels.policy}</h4>
        <p>{draft.cancellationPolicy}</p>
      </div>
      {declining ? (
        <div className="fv-confirm-actions">
          <p className="fv-respond-question">{labels.declineQuestion}</p>
          <button
            type="button"
            className="fv-confirm-yes fv-cancel-yes"
            disabled={sending}
            onClick={() => onAnswer('decline')}
          >
            {labels.declineYes}
          </button>
          <button
            type="button"
            className="fv-confirm-no"
            disabled={sending}
            onClick={() => setDeclining(false)}
          >
            {labels.back}
          </button>
        </div>
      ) : (
        <div className="fv-confirm-actions">
          <button
            type="button"
            className="fv-confirm-yes"
            disabled={sending}
            onClick={() => onAnswer('accept')}
          >
            {labels.accept}
          </button>
          <button
            type="button"
            className="fv-confirm-no fv-respond-decline"
            disabled={sending}
            onClick={() => setDeclining(true)}
          >
            {labels.decline}
          </button>
          <button type="button" className="fv-confirm-no" disabled={sending} onClick={onNotNow}>
            {labels.notNow}
          </button>
        </div>
      )}
      {sending && (
        <p role="status" className="fv-confirm-sending">
          {labels.sending}
        </p>
      )}
    </section>
  );
}
