import { EnvelopeSimple } from '@phosphor-icons/react';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api';
import { useEmail } from './EmailProvider';
import { isEmail, optInEmail } from './email-api';

/**
 * "Email me updates": shown where the guest waits for news (beside the push offer) while the
 * Space has no email. One opt-in covers confirmations, recovery and updates; daily tips are a
 * separate box, unticked.
 */
export function EmailOffer() {
  const { t } = useTranslation();
  const { state, closed, set } = useEmail();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [tips, setTips] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<'invalid' | 'network' | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  if (sentTo) {
    return (
      <div className="alert-offer">
        <p className="alert-offer-hint" role="status">
          {t('email.sent', { email: sentTo })}
        </p>
      </div>
    );
  }
  if (!state || state.email !== null || closed) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const value = email.trim();
    if (!isEmail(value)) {
      setProblem('invalid');
      input.current?.focus();
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const next = await optInEmail(value, tips);
      setSentTo(next.email ?? value);
      set(next);
    } catch (error) {
      setProblem(error instanceof ApiError && error.status === 400 ? 'invalid' : 'network');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="alert-offer">
        <button type="button" className="text-button" onClick={() => setOpen(true)}>
          <EnvelopeSimple aria-hidden="true" size={20} weight="bold" />
          {t('email.offer')}
        </button>
        <p className="alert-offer-hint">{t('email.offerHint')}</p>
      </div>
    );
  }

  const messageId = `${id}-message`;
  return (
    <form className="alert-offer email-form" onSubmit={submit} noValidate>
      <label htmlFor={`${id}-email`}>{t('email.label')}</label>
      <input
        ref={input}
        id={`${id}-email`}
        className="email-input"
        name="email"
        type="email"
        autoComplete="email"
        value={email}
        aria-invalid={problem === 'invalid'}
        aria-describedby={problem ? messageId : undefined}
        onChange={(e) => setEmail(e.target.value)}
      />
      {problem && (
        <p id={messageId} className="message">
          {t(problem === 'invalid' ? 'order.invalidEmail' : 'error.network')}
        </p>
      )}
      <label className="email-check">
        <input
          type="checkbox"
          name="tips"
          checked={tips}
          onChange={(e) => setTips(e.target.checked)}
        />
        {t('email.tips')}
      </label>
      <p className="alert-offer-hint">{t('email.note')}</p>
      <div className="email-actions">
        <button type="submit" className="button" disabled={busy}>
          {t(busy ? 'email.saving' : 'email.save')}
        </button>
        <button type="button" className="text-button" onClick={() => setOpen(false)}>
          {t('email.cancel')}
        </button>
      </div>
    </form>
  );
}
