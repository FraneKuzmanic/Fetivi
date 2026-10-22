import { DIGEST_LIMITS, type HostDeliveryMode } from '@fetivi/domain/host-notification-vocabulary';
import { Plus, X } from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';
import { type HostNotificationSettings, host } from '../../../api';
import { Section, TimeField } from '../../../forms/fields';
import { useSession } from '../../../session';
import { useAction } from '../../../useAction';
import { PhoneAlerts } from './PhoneAlerts';

const MODES: { mode: HostDeliveryMode; label: string; help: string }[] = [
  {
    mode: 'immediate',
    label: 'Immediate',
    help: 'We email you as soon as a guest sends a message.',
  },
  {
    mode: 'digest',
    label: 'Digest',
    help: 'We email you once at each time below with the messages that are waiting. Urgent messages still come straight away.',
  },
];

/** A time not in the list yet, for "Add a time". */
function nextTime(times: string[]): string {
  for (let h = 12; h < 36; h++) {
    const time = `${String(h % 24).padStart(2, '0')}:00`;
    if (!times.includes(time)) return time;
  }
  return '12:00';
}

/** Settings → Notifications (PRD §6.6): how guest messages reach the host. */
export function NotificationsPage() {
  const { me } = useSession();
  const { error, run } = useAction();
  const [settings, setSettings] = useState<HostNotificationSettings | null>(null);
  const [mode, setMode] = useState<HostDeliveryMode>('immediate');
  const [times, setTimes] = useState<string[]>([]);

  const apply = useCallback((s: HostNotificationSettings) => {
    setSettings(s);
    setMode(s.mode);
    setTimes(s.digestTimes);
  }, []);

  useEffect(() => {
    void run(async () => apply(await host.notificationSettings()));
  }, [run, apply]);

  // Phone alerts change only the device count; the unsaved mode and times stay as they are.
  const refreshDevices = () => {
    host.notificationSettings().then(
      (s) => setSettings((current) => (current ? { ...current, push: s.push } : s)),
      () => {},
    );
  };

  const account = me && me !== 'loading' ? me : null;
  const email = account?.actingAs?.email ?? account?.account.email ?? '';
  const help = MODES.find((m) => m.mode === mode)?.help;

  return (
    <>
      <div className="page-head">
        <h1>Notifications</h1>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {settings === null && !error ? <p className="muted">Loading…</p> : null}
      {settings ? (
        <div className="editor">
          <Section
            title="Guest messages"
            onSave={async () =>
              apply(await host.saveNotificationSettings({ mode, digestTimes: times }))
            }
          >
            <fieldset className="segmented choice">
              <legend className="visually-hidden">Delivery</legend>
              {MODES.map((m) => (
                <label key={m.mode}>
                  <input
                    type="radio"
                    name="delivery"
                    className="visually-hidden"
                    checked={mode === m.mode}
                    onChange={() => setMode(m.mode)}
                  />
                  {m.label}
                </label>
              ))}
            </fieldset>
            <p className="muted">{help}</p>
            {mode === 'digest' ? (
              <>
                <ul className="digest-times" aria-label="Digest times">
                  {times.map((time, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: times can repeat while editing
                    <li key={i} className="digest-time">
                      <TimeField
                        label={`Time ${i + 1}`}
                        value={time}
                        onChange={(v) => setTimes(times.map((t, j) => (j === i ? (v ?? '') : t)))}
                      />
                      {times.length > DIGEST_LIMITS.minTimes ? (
                        <button
                          type="button"
                          className="ghost"
                          aria-label={`Remove time ${i + 1}`}
                          onClick={() => setTimes(times.filter((_, j) => j !== i))}
                        >
                          <X aria-hidden="true" />
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {times.length < DIGEST_LIMITS.maxTimes ? (
                  <div className="actions">
                    <button type="button" onClick={() => setTimes([...times, nextTime(times)])}>
                      <Plus aria-hidden="true" />
                      Add a time
                    </button>
                  </div>
                ) : null}
                <p className="muted">
                  Times are in {settings.timezone}, your property's time zone.
                </p>
              </>
            ) : null}
          </Section>
          <Section title="Email">
            <p>
              Emails go to <strong>{email}</strong>. Reply in the inbox, not by email.
            </p>
          </Section>
          <Section title="Phone alerts">
            <PhoneAlerts
              publicKey={settings.push.publicKey}
              devices={settings.push.devices}
              acting={Boolean(account?.actingAs)}
              onChanged={refreshDevices}
            />
          </Section>
        </div>
      ) : null}
    </>
  );
}
