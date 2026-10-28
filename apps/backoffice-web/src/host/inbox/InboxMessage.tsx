import { HANDOFF_LIMITS } from '@fetivi/domain/handoff-vocabulary';
import { ArrowLeft, PaperPlaneTilt } from '@phosphor-icons/react';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type HostMessage, host } from '../../api';
import { useLabels } from '../../i18n/useLabels';
import { useAction } from '../../useAction';
import { dateRange } from '../stays/format';
import { receivedAt, replyDelivery } from './format';

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
  const { t } = useTranslation(['host', 'common']);
  const labels = useLabels();
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
        {t('inbox.allMessages')}
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
          {message.urgency === 'urgent' ? (
            <span className="chip fail">{t('inbox.urgent')}</span>
          ) : null}
          <span className="chip neutral">{labels.handoffReason[message.reason]}</span>
        </p>
      </header>

      <section className="inbox-text" aria-label={t('inbox.guestMessage')}>
        <p className="inbox-body inbox-quote">
          {translated && !showOriginal ? message.translation : message.text}
        </p>
        {translated ? (
          <p className="muted inbox-note">
            {showOriginal
              ? t('inbox.originalIn', { language: labels.language[message.guestLanguage] })
              : t('inbox.translatedFrom', {
                  language: labels.language[message.guestLanguage],
                })}{' '}
            <button
              type="button"
              className="link"
              aria-pressed={showOriginal}
              onClick={() => setShowOriginal((v) => !v)}
            >
              {showOriginal ? t('inbox.showTranslation') : t('inbox.showOriginal')}
            </button>
          </p>
        ) : message.translationState === 'pending' ? (
          <p className="muted inbox-note">
            {t('inbox.translatingFrom', { language: labels.language[message.guestLanguage] })}
          </p>
        ) : message.translationState === 'failed' ? (
          <p className="muted inbox-note">
            {t('inbox.notTranslated', { language: labels.language[message.guestLanguage] })}
          </p>
        ) : null}
      </section>

      {message.reply ? (
        <section className="inbox-reply" aria-label={t('inbox.yourReply')}>
          <h3>{t('inbox.yourReply')}</h3>
          <p className="inbox-body inbox-quote host">{message.reply.text}</p>
          <p className="muted inbox-note">
            {receivedAt(message.reply.repliedAt)} · {replyDelivery(message.reply)}
          </p>
        </section>
      ) : (
        <form className="inbox-reply" onSubmit={send}>
          <label className="field-label" htmlFor={`${id}-reply`}>
            {t('inbox.yourReply')}
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
            {t('inbox.replyHint', {
              language: labels.language[message.guestLanguage],
              length: text.length,
              max,
            })}
          </p>
          {error ? <p role="alert">{error}</p> : null}
          <div>
            <button type="submit" className="with-icon" disabled={busy || !text.trim()}>
              <PaperPlaneTilt aria-hidden="true" />
              {t('inbox.sendReply')}
            </button>
          </div>
        </form>
      )}
    </article>
  );
}
