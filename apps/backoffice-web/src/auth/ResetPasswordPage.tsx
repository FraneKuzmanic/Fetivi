import { Wordmark } from '@fetivi/ui';
import { type FormEvent, type ReactNode, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { auth } from '../api';
import { useAction } from '../useAction';

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const { busy, error, run } = useAction();
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    void run(async () => {
      await auth.confirmReset(token, password);
      setDone(true);
    });
  }

  let body: ReactNode;
  if (!token) {
    body = (
      <p>
        This link is invalid or has expired. <Link to="/forgot-password">Request a new one</Link>
      </p>
    );
  } else if (done) {
    body = (
      <p>
        Your password is changed. <Link to="/login">Log in</Link>
      </p>
    );
  } else {
    body = (
      <form onSubmit={submit}>
        <label>
          New password
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <small>Use at least 10 characters.</small>
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" disabled={busy}>
          Set new password
        </button>
      </form>
    );
  }

  return (
    <main>
      <Wordmark subtitle="Back office" />
      <h2>Choose a new password</h2>
      {body}
    </main>
  );
}
