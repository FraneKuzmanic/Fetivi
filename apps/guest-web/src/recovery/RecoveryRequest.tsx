import { ArrowRight, EnvelopeSimple } from '@phosphor-icons/react';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api';
import { isEmail } from '../email/email-api';
import { requestRecoveryAt } from './recovery-api';

type Problem = 'invalid' | 'link' | 'network';

const PROBLEM_KEYS = {
  invalid: 'order.invalidEmail',
  link: 'link.notFound',
  network: 'error.network',
} as const satisfies Record<Problem, string>;

/** A 400 is an email the server refused; a 404 is a unit link that stopped working. */
function problemOf(error: unknown): Problem {
  if (error instanceof ApiError && error.status === 400) return 'invalid';
  if (error instanceof ApiError && error.status === 404) return 'link';
  return 'network';
}

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
  const [problem, setProblem] = useState<Problem | null>(null);
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
    } catch (error) {
      setProblem(problemOf(error));
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

  // Open, only the email field is left, with its send arrow inside it; Enter sends too.
  const messageId = `${id}-message`;
  return (
    <form className="email-form recovery-form" onSubmit={submit} noValidate>
      <label htmlFor={`${id}-email`} className="visually-hidden">
        {t('recovery.label')}
      </label>
      <div className="recovery-field">
        <input
          ref={input}
          id={`${id}-email`}
          className="email-input"
          name="email"
          type="email"
          autoComplete="email"
          placeholder={t('recovery.label')}
          value={email}
          aria-invalid={problem === 'invalid'}
          aria-describedby={problem ? messageId : undefined}
          onChange={(e) => {
            setEmail(e.target.value);
            setSent(false);
          }}
        />
        <button
          type="submit"
          className="recovery-submit"
          aria-label={t('recovery.send')}
          disabled={busy}
        >
          <ArrowRight aria-hidden="true" weight="bold" />
        </button>
      </div>
      {problem && (
        <p id={messageId} className="message">
          {t(PROBLEM_KEYS[problem])}
        </p>
      )}
      <p className="status" role="status">
        {busy ? t('recovery.sending') : sent ? t('recovery.sent') : ''}
      </p>
    </form>
  );
}
