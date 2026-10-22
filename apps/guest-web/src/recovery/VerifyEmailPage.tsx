import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { ApiError } from '../api';
import { verifyEmail } from '../email/email-api';
import { MascotSays } from '../shell/Mascot';
import { useSpace } from '../space';

type Result = 'verifying' | 'verified' | 'expired' | 'network';

/**
 * A verification link (`/verify-email?token=`). Confirms on load: a scanner opening the link
 * only confirms the address. Works on a device without the Space.
 */
export function VerifyEmailPage() {
  const { t } = useTranslation();
  const { state } = useSpace();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const heading = useRef<HTMLHeadingElement>(null);
  const sent = useRef(false);
  const [result, setResult] = useState<Result>(token ? 'verifying' : 'expired');

  useEffect(() => {
    heading.current?.focus();
    // Once per page, also under StrictMode's double effects: the token is single use.
    if (!token || sent.current) return;
    sent.current = true;
    verifyEmail(token).then(
      () => setResult('verified'),
      (error: unknown) =>
        setResult(error instanceof ApiError && error.status === 400 ? 'expired' : 'network'),
    );
  }, [token]);

  const message = {
    verifying: 'recovery.verifying',
    verified: 'recovery.verified',
    expired: 'recovery.verifyExpired',
    network: 'error.network',
  } as const;

  return (
    <main className="access">
      <p className="access-brand">Fetivi</p>
      <h1 ref={heading} tabIndex={-1}>
        {t('recovery.verifyTitle')}
      </h1>
      <div role="status">
        <MascotSays>{t(message[result])}</MascotSays>
      </div>
      {state.status === 'ready' && result !== 'verifying' && (
        <Link to="/chat" className="button block">
          {t('recovery.backToChat')}
        </Link>
      )}
    </main>
  );
}
