import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { auth } from '../api';
import { useAction } from '../useAction';
import { AuthPage } from './AuthPage';
import { EmailField } from './fields';

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [state, setState] = useState<'checking' | 'verified' | 'invalid'>(
    token ? 'checking' : 'invalid',
  );
  const posted = useRef(false);
  const { t } = useTranslation('auth');

  useEffect(() => {
    // A token is single-use, so post it once even when StrictMode runs effects twice.
    if (!token || posted.current) return;
    posted.current = true;
    auth.verifyEmail(token).then(
      () => setState('verified'),
      () => setState('invalid'),
    );
  }, [token]);

  return (
    <AuthPage title={state === 'verified' ? t('verify.done') : t('verify.title')}>
      {state === 'checking' ? <p role="status">{t('verify.checking')}</p> : null}
      {state === 'verified' ? (
        <Link className="button primary" to="/login">
          {t('logIn')}
        </Link>
      ) : null}
      {state === 'invalid' ? <ResendForm /> : null}
      {state === 'verified' ? null : (
        <p className="auth-alt">
          <Link to="/login">{t('backToLogin')}</Link>
        </p>
      )}
    </AuthPage>
  );
}

function ResendForm() {
  const { t } = useTranslation('auth');
  const { busy, error, run } = useAction();
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    void run(async () => {
      await auth.resendVerification(email);
      setSentTo(email);
    });
  }

  return (
    <>
      <p>{t('verify.invalid')}</p>
      {sentTo ? (
        <p role="status">
          <Trans
            t={t}
            i18nKey="verify.resent"
            values={{ email: sentTo }}
            components={{ strong: <strong className="address" /> }}
          />
        </p>
      ) : (
        <form onSubmit={submit}>
          <EmailField value={email} onChange={setEmail} invalid={!!error} errorId="resend-error" />
          {error ? (
            <p role="alert" id="resend-error" className="form-error">
              {error}
            </p>
          ) : null}
          <button type="submit" className="primary" aria-disabled={busy || undefined}>
            {busy ? t('sending') : t('verify.submit')}
          </button>
        </form>
      )}
    </>
  );
}
