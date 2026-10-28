import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { auth } from '../api';
import { useAction } from '../useAction';

/** Sends the confirmation link again to `email`, and says so. */
export function ResendConfirmation({ email, label }: { email: string; label: string }) {
  const { t } = useTranslation('auth');
  const { busy, error, run } = useAction();
  const [sentTo, setSentTo] = useState<string | null>(null);

  function resend() {
    if (busy) return;
    void run(async () => {
      await auth.resendVerification(email);
      setSentTo(email);
    });
  }

  return (
    <div className="resend">
      <button type="button" aria-disabled={busy || undefined} onClick={resend}>
        {busy ? t('sending') : label}
      </button>
      <p role="status" className="muted">
        {sentTo ? t('resent', { email: sentTo }) : null}
      </p>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
