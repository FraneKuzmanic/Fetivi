import { DotsThreeVertical, Export } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { host } from '../../../api';
import { useAction } from '../../../useAction';
import { applicationServerKey, isInstalled, platform, pushSupported } from './install';

type State = 'checking' | 'off' | 'on' | 'blocked';

/**
 * The guided step for phone alerts (PRD §6.6): add Fetivi Host to the Home Screen, open it from
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
  if (!publicKey) return <p className="muted">Phone alerts are not available yet.</p>;
  if (acting) {
    return <p className="muted">Only the host can turn on alerts on their own phone.</p>;
  }
  return (
    <>
      <Guide publicKey={publicKey} onChanged={onChanged} />
      {devices > 0 ? (
        <p className="muted">
          Alerts are on for {devices} {devices === 1 ? 'device' : 'devices'}.
        </p>
      ) : null}
    </>
  );
}

function Guide({ publicKey, onChanged }: { publicKey: string; onChanged: () => void }) {
  const os = platform();
  if (!isInstalled()) {
    if (os === 'other') {
      return <p>Open this page on your phone to set up alerts. Emails always arrive.</p>;
    }
    return (
      <ol className="steps-list">
        <li>
          <strong>Add Fetivi Host to your Home Screen.</strong>{' '}
          {os === 'ios' ? (
            <>
              In Safari, tap Share <Export aria-label="Share" />, then{' '}
              <strong>Add to Home Screen</strong>.
            </>
          ) : (
            <>
              In Chrome, open the menu <DotsThreeVertical aria-label="menu" />, then{' '}
              <strong>Install app</strong> or <strong>Add to Home screen</strong>.
            </>
          )}
        </li>
        <li>Open Fetivi Host from your Home Screen and come back to this page.</li>
        <li>
          Tap <strong>Turn on alerts</strong>.
        </li>
      </ol>
    );
  }
  if (!pushSupported()) {
    return (
      <p>
        {os === 'ios'
          ? 'Update your phone to iOS 16.4 or later to get alerts.'
          : 'This browser cannot show alerts. Emails always arrive.'}
      </p>
    );
  }
  return <Switch publicKey={publicKey} onChanged={onChanged} />;
}

function Switch({ publicKey, onChanged }: { publicKey: string; onChanged: () => void }) {
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
      {state === 'blocked' ? <p>Alerts are blocked in this browser's settings.</p> : null}
      {state === 'on' ? (
        <div className="actions">
          <p className="saved">Alerts are on for this phone.</p>
          <button type="button" disabled={busy} onClick={() => void turnOff()}>
            Turn off
          </button>
        </div>
      ) : null}
      {state === 'off' ? (
        <div className="actions">
          <button type="button" className="primary" disabled={busy} onClick={() => void turnOn()}>
            Turn on alerts
          </button>
        </div>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </>
  );
}
