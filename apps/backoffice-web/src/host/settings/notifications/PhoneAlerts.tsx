import { DotsThreeVertical, Export } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { host } from '../../../api';
import { useAction } from '../../../useAction';
import { applicationServerKey, isInstalled, platform, pushSupported } from './install';

type State = 'checking' | 'off' | 'on' | 'blocked';

/**
 * The guided step for phone alerts (PRD §6.6): add Fetivi to the Home Screen, open it from
 * there, then turn alerts on. Permission is asked only on the tap (iOS requires a gesture).
 */
export function PhoneAlerts({
  publicKey,
  devices,
  acting,
  onChanged,
}: {
  publicKey: string | null;
  devices: number;
  /** An admin acting as the host: a phone belongs to the person holding it. */
  acting: boolean;
  onChanged: () => void;
}) {
  const { t } = useTranslation(['host', 'common']);
  if (!publicKey) return <p className="muted">{t('settings.alertsUnavailable')}</p>;
  if (acting) {
    return <p className="muted">{t('settings.hostOnly')}</p>;
  }
  return (
    <>
      <Guide publicKey={publicKey} onChanged={onChanged} />
      {devices > 0 ? <p className="muted">{t('settings.alertsOn', { count: devices })}</p> : null}
    </>
  );
}

function Guide({ publicKey, onChanged }: { publicKey: string; onChanged: () => void }) {
  const { t } = useTranslation(['host', 'common']);
  const os = platform();
  if (!isInstalled()) {
    if (os === 'other') {
      return <p>{t('settings.openOnPhone')}</p>;
    }
    return (
      <ol className="steps-list">
        <li>
          <strong>{t('settings.step1')}</strong>{' '}
          {os === 'ios' ? (
            <Trans
              t={t}
              i18nKey="settings.step1Ios"
              components={{
                share: <Export aria-label={t('settings.share')} />,
                strong: <strong />,
              }}
            />
          ) : (
            <Trans
              t={t}
              i18nKey="settings.step1Android"
              components={{
                menu: <DotsThreeVertical aria-label={t('settings.menu')} />,
                strong: <strong />,
              }}
            />
          )}
        </li>
        <li>{t('settings.step2')}</li>
        <li>
          <Trans t={t} i18nKey="settings.step3" components={{ strong: <strong /> }} />
        </li>
      </ol>
    );
  }
  if (!pushSupported()) {
    return <p>{os === 'ios' ? t('settings.updateIos') : t('settings.noAlerts')}</p>;
  }
  return <Switch publicKey={publicKey} onChanged={onChanged} />;
}

function Switch({ publicKey, onChanged }: { publicKey: string; onChanged: () => void }) {
  const { t } = useTranslation(['host', 'common']);
  const { busy, error, run } = useAction();
  const [state, setState] = useState<State>('checking');

  useEffect(() => {
    if (Notification.permission === 'denied') {
      setState('blocked');
      return;
    }
    let live = true;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then(
        (sub) => live && setState(sub ? 'on' : 'off'),
        () => live && setState('off'),
      );
    return () => {
      live = false;
    };
  }, []);

  const turnOn = () =>
    run(async () => {
      const permission = await Notification.requestPermission();
      if (permission === 'denied') return setState('blocked');
      if (permission !== 'granted') return;
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey(publicKey),
      });
      const { endpoint, keys } = sub.toJSON();
      await host.subscribePush({
        endpoint: endpoint ?? sub.endpoint,
        keys: { p256dh: keys?.p256dh ?? '', auth: keys?.auth ?? '' },
      });
      setState('on');
      onChanged();
    });

  const turnOff = () =>
    run(async () => {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await host.unsubscribePush(sub.endpoint);
        await sub.unsubscribe();
      }
      setState('off');
      onChanged();
    });

  return (
    <>
      {state === 'blocked' ? <p>{t('settings.blocked')}</p> : null}
      {state === 'on' ? (
        <div className="actions">
          <p className="saved">{t('settings.onForPhone')}</p>
          <button type="button" disabled={busy} onClick={() => void turnOff()}>
            {t('settings.turnOff')}
          </button>
        </div>
      ) : null}
      {state === 'off' ? (
        <div className="actions">
          <button type="button" className="primary" disabled={busy} onClick={() => void turnOn()}>
            {t('settings.turnOn')}
          </button>
        </div>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </>
  );
}
