import type { GuestLanguage } from '@fetivi/domain/vocabulary';
import { auth } from '../../api';
import { LANGUAGE_LABELS } from '../../forms/labels';
import { useSession } from '../../session';
import { useAction } from '../../useAction';
import { SettingsTabs } from './SettingsTabs';

/** The back office speaks English and Croatian. */
const LANGUAGES: GuestLanguage[] = ['en', 'hr'];

/** Settings → Account: who is signed in and the back-office language. */
export function AccountPage() {
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
        <h2 id="account-heading">Account</h2>
        <dl className="facts">
          <div>
            <dt>Signed in as</dt>
            <dd>{me.account.email}</dd>
          </div>
        </dl>
        <div className="fields">
          <label className="field language-field">
            <span className="field-label">Language</span>
            <select
              value={current}
              disabled={busy}
              onChange={(e) =>
                void run(async () => setMe(await auth.setLanguage(e.target.value as GuestLanguage)))
              }
            >
              {options.map((language) => (
                <option key={language} value={language}>
                  {LANGUAGE_LABELS[language]}
                </option>
              ))}
            </select>
            <small>Guest messages and suggestions reach you translated into this language.</small>
          </label>
        </div>
      </section>
    </>
  );
}
