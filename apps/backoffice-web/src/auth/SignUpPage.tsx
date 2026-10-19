import { Wordmark } from '@fetivi/ui';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { auth } from '../api';
import { useAction } from '../useAction';

export function SignUpPage() {
  const { busy, error, run } = useAction();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sent, setSent] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await auth.signUp(email, password);
      setSent(true);
    });
  }

  return (
    <main>
      <Wordmark subtitle="Back office" />
      <h2>Create a host account</h2>
      {sent ? (
        <p>Check your email. We sent a link to confirm your address.</p>
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
          <label>
            Password
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
            Create account
          </button>
        </form>
      )}
      <p>
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </main>
  );
}
