import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { auth } from '../api';
import { useAction } from '../useAction';
import { AuthPage } from './AuthPage';
import { EmailField } from './fields';

export function ForgotPasswordPage() {
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
    <AuthPage title={sentTo ? 'Check your email' : 'Reset your password'}>
      {sentTo ? (
        <div className="auth-note">
          <p>
            If an account exists for <strong className="address">{sentTo}</strong>, we sent a link
            to reset the password. It works for 1 hour.
          </p>
          <p className="muted">Not there in a minute? Check your spam folder.</p>
          <div className="auth-actions">
            <button type="button" onClick={() => setSentTo(null)}>
              Use a different email
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
            {busy ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}
      <p className="auth-alt">
        <Link to="/login">Back to log in</Link>
      </p>
    </AuthPage>
  );
}
