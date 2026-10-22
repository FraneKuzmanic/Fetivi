import { HANDOFF_LIMITS } from '@fetivi/domain/handoff-vocabulary';
import { ArrowLeft, PaperPlaneTilt } from '@phosphor-icons/react';
import { type FormEvent, useId, useState } from 'react';
import { type HostMessage, host } from '../../api';
import { LANGUAGE_LABELS } from '../../forms/labels';
import { useAction } from '../../useAction';
import { dateRange } from '../stays/format';
import { REASON_LABELS, receivedAt, replyDelivery } from './format';

/** One Host message with the host's reply: the side panel on a wide screen, the page on a phone. */
export function InboxMessage({
  message,
  several,
  onBack,
  onReplied,
}: {
  message: HostMessage;
  /** The host has several properties: name the property too. */
  several: boolean;
  onBack: () => void;
  onReplied: (message: HostMessage) => void;
}) {
  const id = useId();
  const { busy, error, run } = useAction();
  const [showOriginal, setShowOriginal] = useState(false);
  const [text, setText] = useState('');
  const translated = message.translationState === 'done' && message.translation !== null;
  const max = HANDOFF_LIMITS.replyChars;

  const send = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    void run(async () => {
      const { message: updated } = await host.replyMessage(message.id, text);
      setText('');
      onReplied(updated);
    });
  };

  return (
    <article className="panel inbox-detail" aria-labelledby={`${id}-title`}>
      <button type="button" className="ghost inbox-back" onClick={onBack}>
        <ArrowLeft aria-hidden="true" />
        All messages
      </button>
      <header className="inbox-detail-head">
        <h2 id={`${id}-title`}>
          {several ? `${message.propertyName} · ${message.unitName}` : message.unitName}
        </h2>
        <p className="muted">
          {dateRange(message.checkIn, message.checkout)}
          {message.bookerName ? ` · ${message.bookerName}` : ''} · {receivedAt(message.sentAt)}
        </p>
        <p className="chips">
          {message.urgency === 'urgent' ? <span className="chip fail">Urgent</span> : null}
          <span className="chip neutral">{REASON_LABELS[message.reason]}</span>
        </p>
      </header>

      <section className="inbox-text" aria-label="Guest message">
        <p className="inbox-body">
          {translated && !showOriginal ? message.translation : message.text}
        </p>
        {translated ? (
          <p className="muted inbox-note">
            Translated from {LANGUAGE_LABELS[message.guestLanguage]}.{' '}
            <button
              type="button"
              className="link"
              aria-pressed={showOriginal}
              onClick={() => setShowOriginal((v) => !v)}
            >
              {showOriginal ? 'Show translation' : 'Show original'}
            </button>
          </p>
        ) : message.translationState === 'pending' ? (
          <p className="muted inbox-note">
            Translating from {LANGUAGE_LABELS[message.guestLanguage]}…
          </p>
        ) : message.translationState === 'failed' ? (
          <p className="muted inbox-note">
            Not translated: this is the guest's own text in {LANGUAGE_LABELS[message.guestLanguage]}
            .
          </p>
        ) : null}
      </section>

      {message.reply ? (
        <section className="inbox-reply" aria-label="Your reply">
          <h3>Your reply</h3>
          <p className="inbox-body">{message.reply.text}</p>
          <p className="muted inbox-note">
            {receivedAt(message.reply.repliedAt)} · {replyDelivery(message.reply)}
          </p>
        </section>
      ) : (
        <form className="inbox-reply" onSubmit={send}>
          <label className="field-label" htmlFor={`${id}-reply`}>
            Your reply
          </label>
          <textarea
            id={`${id}-reply`}
            rows={4}
            maxLength={max}
            value={text}
            disabled={busy}
            aria-describedby={`${id}-hint`}
            onChange={(e) => setText(e.target.value)}
          />
          <p id={`${id}-hint`} className="muted inbox-note">
            Fetivi translates your reply into {LANGUAGE_LABELS[message.guestLanguage]} and shows it
            in the guest's chat. {text.length} of {max} characters.
          </p>
          {error ? <p role="alert">{error}</p> : null}
          <div>
            <button type="submit" className="with-icon" disabled={busy || !text.trim()}>
              <PaperPlaneTilt aria-hidden="true" />
              Send reply
            </button>
          </div>
        </form>
      )}
    </article>
  );
}
