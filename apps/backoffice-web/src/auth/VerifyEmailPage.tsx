import { Wordmark } from '@fetivi/ui';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { auth } from '../api';
import { useAction } from '../useAction';

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [state, setState] = useState<'checking' | 'verified' | 'invalid'>(
    token ? 'checking' : 'invalid',
  );
  const posted = useRef(false);

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
    <main>
      <Wordmark subtitle="Back office" />
      <h2>Confirm your email</h2>
      {state === 'checking' ? <p>Checking your link…</p> : null}
      {state === 'verified' ? (
        <p>
          Your email is confirmed. <Link to="/login">Log in</Link>
        </p>
      ) : null}
      {state === 'invalid' ? <ResendForm /> : null}
    </main>
  );
}

function ResendForm() {
  const { busy, error, run } = useAction();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await auth.resendVerification(email);
      setSent(true);
    });
  }

  return (
    <>
      <p>This link is invalid or has expired.</p>
      {sent ? (
        <p>If your account still needs confirming, we sent a new link.</p>
      ) : (
        <form onSubmit={submit}>
          <label>
            Email
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          {error ? <p role="alert">{error}</p> : null}
          <button type="submit" disabled={busy}>
            Send a new link
          </button>
        </form>
      )}
    </>
  );
}
