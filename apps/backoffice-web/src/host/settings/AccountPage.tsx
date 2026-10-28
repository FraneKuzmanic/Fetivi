import type { GuestLanguage } from '@fetivi/domain/vocabulary';
import { useTranslation } from 'react-i18next';
import { auth } from '../../api';
import { useLabels } from '../../i18n/useLabels';
import { useSession } from '../../session';
import { useAction } from '../../useAction';
import { SettingsTabs } from './SettingsTabs';

/** The back office speaks English and Croatian. */
const LANGUAGES: GuestLanguage[] = ['en', 'hr'];

/** Settings → Account: who is signed in and the back-office language. */
export function AccountPage() {
  const { t } = useTranslation(['host', 'common']);
  const labels = useLabels();
  const { me, setMe } = useSession();
  const { busy, error, run } = useAction();
  if (!me || me === 'loading') return null;
  const current = me.account.language;
  // An account set to another language before keeps it until it picks one of these.
  const options = LANGUAGES.includes(current) ? LANGUAGES : [...LANGUAGES, current];

  return (
    <>
      <SettingsTabs />
      {error ? <p role="alert">{error}</p> : null}
      <section className="panel" aria-labelledby="account-heading">
        <h2 id="account-heading">{t('settings.account')}</h2>
        <dl className="facts">
          <div>
            <dt>{t('settings.signedInAs')}</dt>
            <dd>{me.account.email}</dd>
          </div>
        </dl>
        <div className="fields">
          <label className="field language-field">
            <span className="field-label">{t('settings.language')}</span>
            <select
              value={current}
              disabled={busy}
              onChange={(e) =>
                void run(async () => setMe(await auth.setLanguage(e.target.value as GuestLanguage)))
              }
            >
              {options.map((language) => (
                <option key={language} value={language}>
                  {labels.language[language]}
                </option>
              ))}
            </select>
            <small>{t('settings.languageHint')}</small>
          </label>
        </div>
      </section>
    </>
  );
}
