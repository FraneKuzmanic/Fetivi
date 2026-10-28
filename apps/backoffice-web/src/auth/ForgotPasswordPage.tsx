import { type FormEvent, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { auth } from '../api';
import { useAction } from '../useAction';
import { AuthPage } from './AuthPage';
import { EmailField } from './fields';

export function ForgotPasswordPage() {
  const { t } = useTranslation('auth');
  const { busy, error, run } = useAction();
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    void run(async () => {
      await auth.requestReset(email);
      setSentTo(email);
    });
  }

  return (
    <AuthPage title={sentTo ? t('checkEmail') : t('forgot.title')}>
      {sentTo ? (
        <div className="auth-note">
          <p>
            <Trans
              t={t}
              i18nKey="forgot.sent"
              values={{ email: sentTo }}
              components={{ strong: <strong className="address" /> }}
            />
          </p>
          <p className="muted">{t('spam')}</p>
          <div className="auth-actions">
            <button type="button" onClick={() => setSentTo(null)}>
              {t('otherEmail')}
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit}>
          <EmailField value={email} onChange={setEmail} invalid={!!error} errorId="forgot-error" />
          {error ? (
            <p role="alert" id="forgot-error" className="form-error">
              {error}
            </p>
          ) : null}
          <button type="submit" className="primary" aria-disabled={busy || undefined}>
            {busy ? t('sending') : t('forgot.submit')}
          </button>
        </form>
      )}
      <p className="auth-alt">
        <Link to="/login">{t('backToLogin')}</Link>
      </p>
    </AuthPage>
  );
}
