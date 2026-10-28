import { MESSAGE_CAP_LIMITS } from '@fetivi/domain/settings-vocabulary';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { admin } from '../../api';
import { NumberField, Section } from '../../forms/fields';
import { usePageTitle } from '../../shell/PageTitle';
import { useAction } from '../../useAction';
import { UsageSection } from './UsageSection';

/**
 * Platform-wide settings: the soft daily message cap per Space (45 AC 5) and the Anthropic usage
 * estimate (52 AC 5).
 */
export function SettingsPage() {
  const { t } = useTranslation(['admin', 'common', 'host']);
  const { error, run } = useAction();
  const [cap, setCap] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void run(async () => {
      setCap((await admin.settings()).dailyMessageCap);
      setLoaded(true);
    });
  }, [run]);

  usePageTitle(t('settings.title'));

  if (!loaded)
    return error ? <p role="alert">{error}</p> : <p className="muted">{t('common:loading')}</p>;

  async function save() {
    if (cap === null) throw new Error(t('settings.chatLimitMissing'));
    setCap((await admin.saveSettings({ dailyMessageCap: cap })).dailyMessageCap);
  }

  return (
    <div className="editor">
      <Section title={t('settings.guestChat')} onSave={save}>
        <div className="field-narrow">
          <NumberField
            label={t('settings.chatLimit')}
            value={cap}
            onChange={setCap}
            min={MESSAGE_CAP_LIMITS.min}
            max={MESSAGE_CAP_LIMITS.max}
            required
          />
        </div>
      </Section>
      <UsageSection />
    </div>
  );
}
