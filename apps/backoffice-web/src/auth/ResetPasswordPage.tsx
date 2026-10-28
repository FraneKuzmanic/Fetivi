import { type FormEvent, type ReactNode, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { auth } from '../api';
import { useAction } from '../useAction';
import { AuthPage } from './AuthPage';
import { PasswordField } from './fields';

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const { t } = useTranslation('auth');
  const { busy, error, run } = useAction();
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!token || busy) return;
    void run(async () => {
      await auth.confirmReset(token, password);
      setDone(true);
    });
  }

  let body: ReactNode;
  if (!token) {
    body = (
      <p>
        <Trans
          t={t}
          i18nKey="reset.invalid"
          components={{ anchor: <Link to="/forgot-password" /> }}
        />
      </p>
    );
  } else if (done) {
    body = (
      <Link className="button primary" to="/login">
        {t('logIn')}
      </Link>
    );
  } else {
    body = (
      <form onSubmit={submit}>
        <PasswordField
          label={t('newPassword')}
          autoComplete="new-password"
          isNew
          hint={t('passwordHint')}
          value={password}
          onChange={setPassword}
          invalid={!!error}
          errorId="reset-error"
        />
        {error ? (
          <p role="alert" id="reset-error" className="form-error">
            {error}
          </p>
        ) : null}
        <button type="submit" className="primary" aria-disabled={busy || undefined}>
          {busy ? t('reset.saving') : t('reset.submit')}
        </button>
      </form>
    );
  }

  return (
    <AuthPage title={done ? t('reset.done') : t('reset.title')}>
      {body}
      {done ? null : (
        <p className="auth-alt">
          <Link to="/login">{t('backToLogin')}</Link>
        </p>
      )}
    </AuthPage>
  );
}
