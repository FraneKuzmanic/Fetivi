import { type FormEvent, useState } from 'react';
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
    <AuthPage title="Log in">
      <form onSubmit={submit}>
        <EmailField value={email} onChange={setEmail} invalid={!!error} errorId="login-error" />
        <PasswordField
          label="Password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          invalid={!!error}
          errorId="login-error"
          aside={<Link to="/forgot-password">Forgot password?</Link>}
        />
        {error ? (
          <p role="alert" id="login-error" className="form-error">
            {error}
          </p>
        ) : null}
        {unverified ? (
          <ResendConfirmation email={unverified} label="Send a new confirmation link" />
        ) : null}
        <button type="submit" className="primary" aria-disabled={busy || undefined}>
          {busy ? 'Logging in…' : 'Log in'}
        </button>
      </form>
      <p className="auth-alt">
        New host? <Link to="/sign-up">Create an account</Link>
      </p>
      <p className="auth-guest muted">
        Staying at a Fetivi property? Open the link or QR code from your host instead.
      </p>
    </AuthPage>
  );
}
