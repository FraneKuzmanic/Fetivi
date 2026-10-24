import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { setKeepForEvaluation } from '../api';
import { useEmail } from '../email/EmailProvider';
import { resendVerification, setTips } from '../email/email-api';
import { requestRecovery } from '../recovery/recovery-api';
import { useSpace } from '../space';

type RequestStatus = 'idle' | 'busy' | 'sent' | 'failed';

/**
 * The Space's email, how to open it on another device, and the evaluation opt-in. The email is
 * shown, never asked for here: it is asked at booking or with the update offer.
 */
export function SettingsPage() {
  const { t } = useTranslation();
  const { state: space, setSpace } = useSpace();
  const closed = space.status === 'ready' ? space.space.closed : true;
  const keep = space.status === 'ready' && space.space.keepForEvaluation;
  const { state, set } = useEmail();
  const heading = useRef<HTMLHeadingElement>(null);
  const [resend, setResend] = useState<RequestStatus>('idle');
  const [linkRequest, setLinkRequest] = useState<RequestStatus>('idle');
  const [tipsFailed, setTipsFailed] = useState(false);
  const [keepFailed, setKeepFailed] = useState(false);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  const send = async (run: () => Promise<void>, update: (s: RequestStatus) => void) => {
    update('busy');
    try {
      await run();
      update('sent');
    } catch {
      update('failed');
    }
  };

  const toggleTips = async (tips: boolean) => {
    setTipsFailed(false);
    try {
      set(await setTips(tips));
    } catch {
      setTipsFailed(true);
    }
  };

  // Consent can be given or withdrawn until the Space is deleted, so this stays after checkout.
  // A failed save leaves the space as it was, so the box shows its old state again.
  const toggleKeep = async (next: boolean) => {
    setKeepFailed(false);
    try {
      setSpace(await setKeepForEvaluation(next));
    } catch {
      setKeepFailed(true);
    }
  };

  const email = state?.email ?? null;

  return (
    <section className="settings" aria-labelledby="tab-title">
      <h1 id="tab-title" ref={heading} tabIndex={-1}>
        {t('settings.title')}
      </h1>

      <section className="settings-section" aria-labelledby="settings-email">
        <h2 id="settings-email">{t('settings.emailTitle')}</h2>
        {state === null ? (
          <p className="status">{t('common.loading')}</p>
        ) : email === null ? (
          <p className="settings-note">{t('settings.noEmail')}</p>
        ) : (
          <>
            <p className="settings-email">
              <span>{email}</span>
              <span className={state.verified ? 'settings-badge confirmed' : 'settings-badge'}>
                {t(state.verified ? 'settings.confirmed' : 'settings.waiting')}
              </span>
            </p>
            {!state.verified && !closed && (
              <button
                type="button"
                className="text-button settings-inline"
                disabled={resend === 'busy'}
                onClick={() => send(resendVerification, setResend)}
              >
                {t('settings.resend')}
              </button>
            )}
            {!closed && (
              <label className="email-check">
                <input
                  type="checkbox"
                  checked={state.tips}
                  onChange={(e) => toggleTips(e.target.checked)}
                />
                {t('settings.tips')}
              </label>
            )}
            <p className="status" role="status">
              {resend === 'sent'
                ? t('settings.resent')
                : resend === 'failed' || tipsFailed
                  ? t('error.network')
                  : ''}
            </p>
          </>
        )}
      </section>

      <section className="settings-section" aria-labelledby="settings-device">
        <h2 id="settings-device">{t('settings.deviceTitle')}</h2>
        <p className="settings-note">{t(email ? 'settings.deviceIntro' : 'settings.noEmail')}</p>
        <button
          type="button"
          className="button settings-action"
          disabled={!email || linkRequest === 'busy'}
          onClick={() => send(requestRecovery, setLinkRequest)}
        >
          {t('settings.sendLink')}
        </button>
        <p className="status" role="status">
          {linkRequest === 'sent'
            ? t('settings.linkSent')
            : linkRequest === 'failed'
              ? t('error.network')
              : ''}
        </p>
      </section>

      <section className="settings-section" aria-labelledby="settings-evaluation">
        <h2 id="settings-evaluation">{t('settings.evaluationTitle')}</h2>
        <label className="email-check">
          <input
            type="checkbox"
            checked={keep}
            aria-describedby="settings-evaluation-note"
            onChange={(e) => toggleKeep(e.target.checked)}
          />
          {t('settings.evaluation')}
        </label>
        <p id="settings-evaluation-note" className="settings-note">
          {t('settings.evaluationNote')}
        </p>
        <p className="status" role="status">
          {keepFailed ? t('error.network') : ''}
        </p>
      </section>
    </section>
  );
}
