import { GUEST_LANGUAGES } from '@fetivi/domain/vocabulary';
import { auth } from '../../api';
import { SelectField } from '../../forms/fields';
import { useSession } from '../../session';
import { useAction } from '../../useAction';
import { useWizardCopy } from './copy';

/** The viewer's own back-office language; the wizard copy follows it at once. */
export function LanguagePicker() {
  const { me, setMe } = useSession();
  const { ui, languages } = useWizardCopy();
  const { error, run } = useAction();
  if (!me || me === 'loading') return null;
  return (
    <div className="language-picker">
      <SelectField
        label={ui.language}
        value={me.account.language}
        options={GUEST_LANGUAGES}
        labels={languages}
        onChange={(language) => {
          if (language) void run(async () => setMe(await auth.setLanguage(language)));
        }}
      />
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
