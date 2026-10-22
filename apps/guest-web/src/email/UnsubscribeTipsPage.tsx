import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { ApiError } from '../api';
import { MascotSays } from '../shell/Mascot';
import { useSpace } from '../space';
import { unsubscribeTips } from './email-api';

type Result = 'working' | 'done' | 'invalid' | 'network';

/**
 * The daily-tip email's unsubscribe link (`/unsubscribe-tips?space=&token=`). Unsubscribes on
 * load, so one click is enough; it only ever turns tips off. Works on a device without the Space.
 */
export function UnsubscribeTipsPage() {
  const { t } = useTranslation();
  const { state } = useSpace();
  const [params] = useSearchParams();
  const space = params.get('space') ?? '';
  const token = params.get('token') ?? '';
  const heading = useRef<HTMLHeadingElement>(null);
  const sent = useRef(false);
  const [result, setResult] = useState<Result>(space && token ? 'working' : 'invalid');

  useEffect(() => {
    heading.current?.focus();
    // Once per page, also under StrictMode's double effects.
    if (!space || !token || sent.current) return;
    sent.current = true;
    unsubscribeTips(space, token).then(
      () => setResult('done'),
      (error: unknown) =>
        setResult(error instanceof ApiError && error.status === 400 ? 'invalid' : 'network'),
    );
  }, [space, token]);

  const message = {
    working: 'unsubscribeTips.working',
    done: 'unsubscribeTips.done',
    invalid: 'unsubscribeTips.invalid',
    network: 'error.network',
  } as const;

  return (
    <main className="access">
      <p className="access-brand">Fetivi</p>
      <h1 ref={heading} tabIndex={-1}>
        {t('unsubscribeTips.title')}
      </h1>
      <div role="status">
        <MascotSays>{t(message[result])}</MascotSays>
      </div>
      {state.status === 'ready' && result !== 'working' && (
        <Link to="/chat" className="button block">
          {t('recovery.backToChat')}
        </Link>
      )}
    </main>
  );
}
