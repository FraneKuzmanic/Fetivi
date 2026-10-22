import { HANDOFF_LIMITS } from '@fetivi/domain/handoff-vocabulary';
import { PaperPlaneTilt } from '@phosphor-icons/react';
import { type FormEvent, useId, useRef, useState } from 'react';
import type { HostMessageDraftPayload } from '../../payloads';

export interface HostDraftLabels {
  heading: string;
  /** That Fetivi translates it and nothing is sent before Send. */
  explain: string;
  label: string;
  counter: (count: number, max: number) => string;
  empty: string;
  urgent: string;
  send: string;
  cancel: string;
  sending: string;
}

/**
 * The host message draft card: the stored draft, editable by the guest, sent only on Send.
 * Urgency is Fetivi's and only shown. The card never takes focus on its own.
 */
export function HostDraftCard({
  draft,
  state,
  onSend,
  onCancel,
  labels,
}: {
  draft: HostMessageDraftPayload;
  state: 'open' | 'sending';
  onSend: (text: string) => void;
  onCancel: () => void;
  labels: HostDraftLabels;
}) {
  const id = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(draft.text);
  const [empty, setEmpty] = useState(false);
  const sending = state === 'sending';
  const headingId = `${id}-heading`;
  const fieldId = `${id}-message`;
  const counterId = `${id}-counter`;
  const errorId = `${id}-error`;
  const max = HANDOFF_LIMITS.messageChars;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (sending) return;
    const clean = text.trim();
    if (!clean) {
      setEmpty(true);
      area.current?.focus();
      return;
    }
    setEmpty(false);
    onSend(clean);
  };

  return (
    <section className="fv-confirm fv-host-draft" aria-labelledby={headingId}>
      <h3 id={headingId} className="fv-confirm-heading">
        {labels.heading}
      </h3>
      <p className="fv-confirm-note">{labels.explain}</p>
      {draft.urgency === 'urgent' && (
        <p className="fv-status fv-host-urgent">
          <span className="fv-status-dot" data-tone="urgent" aria-hidden="true" />
          {labels.urgent}
        </p>
      )}
      <form noValidate aria-labelledby={headingId} onSubmit={submit}>
        <div className="fv-field">
          <label htmlFor={fieldId}>{labels.label}</label>
          <textarea
            ref={area}
            id={fieldId}
            name="message"
            rows={4}
            maxLength={max}
            required
            disabled={sending}
            value={text}
            aria-invalid={empty || undefined}
            aria-describedby={empty ? `${errorId} ${counterId}` : counterId}
            onChange={(e) => setText(e.target.value)}
          />
          <p id={counterId} className="fv-field-hint">
            {labels.counter(text.length, max)}
          </p>
          {empty && (
            <p id={errorId} className="fv-field-error">
              {labels.empty}
            </p>
          )}
        </div>
        <div className="fv-confirm-actions">
          <button type="submit" className="fv-confirm-yes fv-host-send" disabled={sending}>
            <PaperPlaneTilt size={18} weight="bold" aria-hidden="true" />
            {labels.send}
          </button>
          <button type="button" className="fv-confirm-no" disabled={sending} onClick={onCancel}>
            {labels.cancel}
          </button>
        </div>
        {sending && (
          <p role="status" className="fv-confirm-sending">
            {labels.sending}
          </p>
        )}
      </form>
    </section>
  );
}
