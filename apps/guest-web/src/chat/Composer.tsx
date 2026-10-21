import { PaperPlaneRight } from '@phosphor-icons/react';
import type { FormEvent, KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Enter sends, as the keyboard's "send" key promises; Shift+Enter adds a line. Enter that ends an
 * IME composition or dictation only commits the text.
 */
export const sendsOnKey = (key: { key: string; shiftKey: boolean; isComposing: boolean }) =>
  key.key === 'Enter' && !key.shiftKey && !key.isComposing;

/**
 * The text box stays editable while Fetivi answers (never disabled or read-only), so the phone
 * keyboard and its dictation keep working; only the send button waits.
 */
export function Composer({
  value,
  onChange,
  onSend,
  busy,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: (text: string) => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const text = value.trim();
  const canSend = text.length > 0 && !busy;

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (canSend) onSend(text);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      sendsOnKey({
        key: event.key,
        shiftKey: event.shiftKey,
        isComposing: event.nativeEvent.isComposing,
      })
    ) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <form className="composer" onSubmit={submit}>
      <div className="composer-inner">
        <label htmlFor="chat-input" className="visually-hidden">
          {t('chat.inputLabel')}
        </label>
        <textarea
          id="chat-input"
          rows={1}
          maxLength={4000}
          enterKeyHint="send"
          autoComplete="off"
          placeholder={t('chat.placeholder')}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <button type="submit" className="send-button" disabled={!canSend}>
          <PaperPlaneRight aria-hidden="true" weight="fill" />
          <span className="visually-hidden">{t('chat.send')}</span>
        </button>
      </div>
    </form>
  );
}
