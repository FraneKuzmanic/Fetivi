import { MESSAGE_CAP_LIMITS } from '@fetivi/domain/settings-vocabulary';
import { useEffect, useState } from 'react';
import { admin } from '../../api';
import { NumberField, Section } from '../../forms/fields';
import { usePageTitle } from '../../shell/PageTitle';
import { useAction } from '../../useAction';

/** Platform-wide settings: the soft daily message cap per Space (45 AC 5). */
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

  usePageTitle('Settings');

  if (!loaded) return error ? <p role="alert">{error}</p> : <p className="muted">Loading…</p>;

  async function save() {
    if (cap === null) throw new Error('Enter a daily chat limit.');
    setCap((await admin.saveSettings({ dailyMessageCap: cap })).dailyMessageCap);
  }

  return (
    <div className="editor">
      <Section title="Guest chat" onSave={save}>
        <div className="field-narrow">
          <NumberField
            label="Daily chat limit per guest device"
            value={cap}
            onChange={setCap}
            min={MESSAGE_CAP_LIMITS.min}
            max={MESSAGE_CAP_LIMITS.max}
            required
          />
        </div>
      </Section>
    </div>
  );
}
