import {
  DeviceMobile,
  EnvelopeSimple,
  GraduationCap,
  type Icon,
  SignOut,
  Translate,
} from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageOptions } from '../access/LanguagePicker';
import { setKeepForEvaluation } from '../api';
import { useEmail } from '../email/EmailProvider';
import { resendVerification, setTips } from '../email/email-api';
import { isLanguage } from '../i18n/browser-language';
import { requestRecovery } from '../recovery/recovery-api';
import { useSpace } from '../space';

type RequestStatus = 'idle' | 'busy' | 'sent' | 'failed';

/**
 * The interface language, the Space's email, how to open it on another device, and the evaluation opt-in. The email is
 * shown, never asked for here: it is asked at booking or with the update offer.
 */
export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const { state: space, setSpace, changeLanguage } = useSpace();
  const language = isLanguage(i18n.language) ? i18n.language : 'en';
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

      <section className="settings-section" aria-labelledby="settings-language">
        <SettingsHeading id="settings-language" icon={Translate}>
          {t('settings.languageTitle')}
        </SettingsHeading>
        <LanguageOptions current={language} onPick={(next) => void changeLanguage(next)} />
      </section>

      <section className="settings-section" aria-labelledby="settings-email">
        <SettingsHeading id="settings-email" icon={EnvelopeSimple}>
          {t('settings.emailTitle')}
        </SettingsHeading>
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
              <label className="settings-switch">
                <span>{t('settings.tips')}</span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={state.tips}
                  aria-checked={state.tips}
                  onChange={(e) => toggleTips(e.target.checked)}
                />
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
        <SettingsHeading id="settings-device" icon={DeviceMobile}>
          {t('settings.deviceTitle')}
        </SettingsHeading>
        <p className="settings-note">{t('settings.deviceIntro')}</p>
        <p className="settings-fact">
          <SignOut aria-hidden="true" />
          {t('settings.deviceSignOut')}
        </p>
        <div className="settings-action-row">
          <button
            type="button"
            className="button settings-action"
            disabled={!email || linkRequest === 'busy'}
            aria-describedby={email ? undefined : 'settings-device-needs'}
            onClick={() => send(requestRecovery, setLinkRequest)}
          >
            {t('settings.sendLink')}
          </button>
          {state !== null && !email && (
            <p id="settings-device-needs" className="settings-needs">
              {t('settings.needsEmail')}
            </p>
          )}
        </div>
        <p className="status" role="status">
          {linkRequest === 'sent'
            ? t('settings.linkSent')
            : linkRequest === 'failed'
              ? t('error.network')
              : ''}
        </p>
      </section>

      <section className="settings-section" aria-labelledby="settings-evaluation">
        <SettingsHeading id="settings-evaluation" icon={GraduationCap}>
          {t('settings.evaluationTitle')}
        </SettingsHeading>
        <label className="settings-switch">
          <span>{t('settings.evaluation')}</span>
          <input
            type="checkbox"
            role="switch"
            checked={keep}
            aria-checked={keep}
            onChange={(e) => toggleKeep(e.target.checked)}
          />
        </label>
        <p className="status" role="status">
          {keepFailed ? t('error.network') : ''}
        </p>
      </section>
    </section>
  );
}

/** A Settings group's title with its icon. */
function SettingsHeading({
  id,
  icon: Icon,
  children,
}: {
  id: string;
  icon: Icon;
  children: string;
}) {
  return (
    <h2 id={id} className="settings-heading">
      <span className="settings-heading-icon">
        <Icon aria-hidden="true" />
      </span>
      {children}
    </h2>
  );
}
