import { Wordmark } from '@fetivi/ui';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { auth } from '../api';
import { useAction } from '../useAction';

export function ForgotPasswordPage() {
  const { busy, error, run } = useAction();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await auth.requestReset(email);
      setSent(true);
    });
  }

  return (
    <main>
      <Wordmark subtitle="Back office" />
      <h2>Reset your password</h2>
      {sent ? (
        <p>If an account exists for that email, we sent a link to reset the password.</p>
      ) : (
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
          {error ? <p role="alert">{error}</p> : null}
          <button type="submit" disabled={busy}>
            Send reset link
          </button>
        </form>
      )}
      <p>
        <Link to="/login">Back to log in</Link>
      </p>
    </main>
  );
}
