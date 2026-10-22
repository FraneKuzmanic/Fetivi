import { EnvelopeSimple } from '@phosphor-icons/react';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isEmail } from '../email/email-api';
import { requestRecoveryAt } from './recovery-api';

/**
 * Under the PIN: a guest who used Fetivi on another phone asks for a link by email. The answer
 * is the same whether or not the email belongs to a Space here.
 */
export function RecoveryRequest({ slug }: { slug: string }) {
  const { t } = useTranslation();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<'invalid' | 'network' | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

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
      await requestRecoveryAt(slug, value);
      setSent(true);
    } catch {
      setProblem('network');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className="text-button recovery-ask" onClick={() => setOpen(true)}>
        <EnvelopeSimple aria-hidden="true" />
        {t('recovery.ask')}
      </button>
    );
  }

  const messageId = `${id}-message`;
  return (
    <form className="email-form recovery-form" onSubmit={submit} noValidate>
      <p className="settings-note">{t('recovery.ask')}</p>
      <label htmlFor={`${id}-email`}>{t('recovery.label')}</label>
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
        onChange={(e) => {
          setEmail(e.target.value);
          setSent(false);
        }}
      />
      {problem && (
        <p id={messageId} className="message">
          {t(problem === 'invalid' ? 'order.invalidEmail' : 'error.network')}
        </p>
      )}
      <p className="status" role="status">
        {sent ? t('recovery.sent') : ''}
      </p>
      <button type="submit" className="button" disabled={busy}>
        {t(busy ? 'recovery.sending' : 'recovery.send')}
      </button>
    </form>
  );
}
