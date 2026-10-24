import { MESSAGE_CAP_LIMITS } from '@fetivi/domain/settings-vocabulary';
import { useEffect, useState } from 'react';
import { admin } from '../../api';
import { NumberField, Section } from '../../forms/fields';
import { useAction } from '../../useAction';

/** Platform-wide settings: the soft daily message cap per guest device (45 AC 5). */
export function SettingsPage() {
  const { error, run } = useAction();
  const [cap, setCap] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void run(async () => {
      setCap((await admin.settings()).dailyMessageCap);
      setLoaded(true);
    });
  }, [run]);

  if (!loaded) return error ? <p role="alert">{error}</p> : <p className="muted">Loading…</p>;

  async function save() {
    if (cap === null) throw new Error('Enter a daily message limit.');
    setCap((await admin.saveSettings({ dailyMessageCap: cap })).dailyMessageCap);
  }

  return (
    <>
      <div className="page-head">
        <h1>Settings</h1>
      </div>
      <div className="editor">
        <Section title="Guest chat" onSave={save}>
          <NumberField
            label="Daily message limit per guest device"
            hint="After this many messages in a day, chat pauses until midnight at the property. Guide and My trip keep working."
            value={cap}
            onChange={setCap}
            min={MESSAGE_CAP_LIMITS.min}
            max={MESSAGE_CAP_LIMITS.max}
            required
          />
        </Section>
      </div>
    </>
  );
}
