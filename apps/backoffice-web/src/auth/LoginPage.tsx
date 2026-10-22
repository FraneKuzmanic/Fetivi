import { Wordmark } from '@fetivi/ui';
import { type FormEvent, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { auth } from '../api';
import { useSession } from '../session';
import { useAction } from '../useAction';

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

  if (me && me !== 'loading') return <Navigate to={from} replace />;

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      setMe(await auth.login(email, password));
      navigate(from, { replace: true });
    });
  }

  return (
    <main>
      <Wordmark subtitle="Back office" />
      <h2>Log in</h2>
      <form onSubmit={submit}>
        <label>
          Email
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" disabled={busy}>
          Log in
        </button>
      </form>
      <p>
        <Link to="/forgot-password">Forgot your password?</Link>
      </p>
      <p>
        New host? <Link to="/sign-up">Create an account</Link>
      </p>
    </main>
  );
}
