import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { ApiError } from '../api';
import { MascotSays } from '../shell/Mascot';
import { useSpace } from '../space';
import { restore } from './recovery-api';

/**
 * A recovery link (`/recover?token=`). It needs a tap: mail scanners that open links must not
 * spend the single-use token. Opening it here signs the other device out (ADR 0009).
 */
export function RecoverPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { setSpace } = useSpace();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const heading = useRef<HTMLHeadingElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<'expired' | 'network' | null>(token ? null : 'expired');

  useEffect(() => {
    heading.current?.focus();
  }, []);

  const open = async () => {
    setBusy(true);
    setProblem(null);
    try {
      setSpace(await restore(token));
      navigate('/chat', { replace: true });
    } catch (error) {
      setProblem(error instanceof ApiError && error.status === 400 ? 'expired' : 'network');
      setBusy(false);
    }
  };

  return (
    <main className="access">
      <p className="access-brand">Fetivi</p>
      <h1 ref={heading} tabIndex={-1}>
        {t('recovery.title')}
      </h1>
      {problem === 'expired' ? (
        <MascotSays>{t('recovery.expired')}</MascotSays>
      ) : (
        <>
          <MascotSays>{t('recovery.welcome')}</MascotSays>
          <p className="message" role="status">
            {problem === 'network' ? t('error.network') : ''}
          </p>
          <button type="button" className="button block" onClick={open} disabled={busy}>
            {t(busy ? 'recovery.opening' : 'recovery.open')}
          </button>
        </>
      )}
    </main>
  );
}
