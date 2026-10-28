import { type FormEvent, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { ApiError, auth } from '../api';
import { useSession } from '../session';
import { useAction } from '../useAction';
import { AuthPage } from './AuthPage';
import { EmailField, PasswordField } from './fields';
import { ResendConfirmation } from './ResendConfirmation';

/** Where to go after login: a same-origin path only (no `//host` or `/\host`), else home. */
function returnPath(state: unknown): string {
  const from = (state as { from?: unknown } | null)?.from;
  return typeof from === 'string' && /^\/(?![/\\])/.test(from) ? from : '/';
}

export function LoginPage() {
  const { me, setMe } = useSession();
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const from = returnPath(useLocation().state);
  const { busy, error, run } = useAction();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // The address that logged in before confirming it: it gets a resend button.
  const [unverified, setUnverified] = useState<string | null>(null);

  if (me && me !== 'loading') return <Navigate to={from} replace />;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setUnverified(null);
    void run(async () => {
      try {
        setMe(await auth.login(email, password));
      } catch (e) {
        if (e instanceof ApiError && e.code === 'email-not-verified') setUnverified(email);
        throw e;
      }
      navigate(from, { replace: true });
    });
  }

  return (
    <AuthPage title={t('logIn')}>
      <form onSubmit={submit}>
        <EmailField value={email} onChange={setEmail} invalid={!!error} errorId="login-error" />
        <PasswordField
          label={t('password')}
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          invalid={!!error}
          errorId="login-error"
          aside={<Link to="/forgot-password">{t('login.forgot')}</Link>}
        />
        {error ? (
          <p role="alert" id="login-error" className="form-error">
            {error}
          </p>
        ) : null}
        {unverified ? <ResendConfirmation email={unverified} label={t('login.resend')} /> : null}
        <button type="submit" className="primary" aria-disabled={busy || undefined}>
          {busy ? t('login.loggingIn') : t('logIn')}
        </button>
      </form>
      <p className="auth-alt">
        <Trans t={t} i18nKey="login.newHost" components={{ anchor: <Link to="/sign-up" /> }} />
      </p>
    </AuthPage>
  );
}
