import { type FormEvent, type ReactNode, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { auth } from '../api';
import { useAction } from '../useAction';
import { AuthPage } from './AuthPage';
import { PasswordField } from './fields';

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
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
        This link is invalid or has expired. <Link to="/forgot-password">Request a new one</Link>
      </p>
    );
  } else if (done) {
    body = (
      <Link className="button primary" to="/login">
        Log in
      </Link>
    );
  } else {
    body = (
      <form onSubmit={submit}>
        <PasswordField
          label="New password"
          autoComplete="new-password"
          isNew
          hint="Use at least 10 characters."
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
          {busy ? 'Saving…' : 'Set new password'}
        </button>
      </form>
    );
  }

  return (
    <AuthPage title={done ? 'Your password is changed' : 'Choose a new password'}>
      {body}
      {done ? null : (
        <p className="auth-alt">
          <Link to="/login">Back to log in</Link>
        </p>
      )}
    </AuthPage>
  );
}
