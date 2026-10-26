import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { auth } from '../api';
import { useAction } from '../useAction';
import { AuthPage } from './AuthPage';
import { EmailField, PasswordField } from './fields';
import { ResendConfirmation } from './ResendConfirmation';

export function SignUpPage() {
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
      <AuthPage title="Check your email">
        <div className="auth-note">
          <p>
            We sent a confirmation link to <strong className="address">{sentTo}</strong>. It works
            for 24 hours.
          </p>
          <p className="muted">Not there in a minute? Check your spam folder.</p>
          <div className="auth-actions">
            <ResendConfirmation email={sentTo} label="Send it again" />
            <button type="button" className="ghost" onClick={() => setSentTo(null)}>
              Use a different email
            </button>
          </div>
        </div>
        <section className="next-steps" aria-labelledby="next-steps-title">
          <h2 id="next-steps-title">What happens next</h2>
          <ol>
            <li>Open the link to confirm your email, then log in.</li>
            <li>Add your property and its units.</li>
            <li>Fetivi checks and approves the property.</li>
            <li>Fill in the guide. Once the essentials are in, your unit goes live.</li>
          </ol>
        </section>
      </AuthPage>
    );
  }

  return (
    <AuthPage title="Create a host account">
      <form onSubmit={submit}>
        <EmailField value={email} onChange={setEmail} invalid={!!error} errorId="sign-up-error" />
        <PasswordField
          label="Password"
          autoComplete="new-password"
          isNew
          hint="Use at least 10 characters."
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
          {busy ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <p className="auth-alt">
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </AuthPage>
  );
}
