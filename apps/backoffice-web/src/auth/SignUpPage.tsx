import { type FormEvent, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { auth } from '../api';
import { useAction } from '../useAction';
import { AuthPage } from './AuthPage';
import { EmailField, PasswordField } from './fields';
import { ResendConfirmation } from './ResendConfirmation';

export function SignUpPage() {
  const { t } = useTranslation('auth');
  const { busy, error, run } = useAction();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    void run(async () => {
      await auth.signUp(email, password);
      setSentTo(email);
    });
  }

  if (sentTo) {
    return (
      <AuthPage title={t('checkEmail')}>
        <div className="auth-note">
          <p>
            <Trans
              t={t}
              i18nKey="signUp.sent"
              values={{ email: sentTo }}
              components={{ strong: <strong className="address" /> }}
            />
          </p>
          <p className="muted">{t('spam')}</p>
          <div className="auth-actions">
            <ResendConfirmation email={sentTo} label={t('signUp.sendAgain')} />
            <button type="button" onClick={() => setSentTo(null)}>
              {t('otherEmail')}
            </button>
          </div>
        </div>
        <section className="next-steps" aria-labelledby="next-steps-title">
          <h2 id="next-steps-title">{t('signUp.nextTitle')}</h2>
          <ol>
            <li>{t('signUp.next1')}</li>
            <li>{t('signUp.next2')}</li>
            <li>{t('signUp.next3')}</li>
            <li>{t('signUp.next4')}</li>
          </ol>
        </section>
      </AuthPage>
    );
  }

  return (
    <AuthPage title={t('signUp.title')} intro>
      <form onSubmit={submit}>
        <EmailField value={email} onChange={setEmail} invalid={!!error} errorId="sign-up-error" />
        <PasswordField
          label={t('password')}
          autoComplete="new-password"
          isNew
          hint={t('passwordHint')}
          value={password}
          onChange={setPassword}
          invalid={!!error}
          errorId="sign-up-error"
        />
        {error ? (
          <p role="alert" id="sign-up-error" className="form-error">
            {error}
          </p>
        ) : null}
        <button type="submit" className="primary" aria-disabled={busy || undefined}>
          {busy ? t('signUp.creating') : t('signUp.submit')}
        </button>
      </form>
      <p className="auth-alt">
        <Trans t={t} i18nKey="signUp.haveAccount" components={{ anchor: <Link to="/login" /> }} />
      </p>
    </AuthPage>
  );
}
