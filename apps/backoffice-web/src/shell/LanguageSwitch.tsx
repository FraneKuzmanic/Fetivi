import { BACKOFFICE_LANGUAGES } from '@fetivi/domain/vocabulary';
import { Translate } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { currentLanguage, setLanguage } from '../i18n';
import { LANGUAGE_NAMES } from '../i18n/languages';
import { storeLanguage } from '../i18n/stored-language';

/**
 * The signed-out pages' language switch: each language under its own name. The choice stays on
 * this browser and goes with the sign-up or sign-in; it is not an account's choice.
 */
export function LanguageSwitch() {
  const { t } = useTranslation('shell');
  const current = currentLanguage();
  return (
    <fieldset className="language-switch">
      <legend className="visually-hidden">{t('language')}</legend>
      <Translate aria-hidden="true" />
      {BACKOFFICE_LANGUAGES.map((language) => (
        <button
          key={language}
          type="button"
          className="ghost"
          lang={language}
          aria-pressed={language === current}
          onClick={() => {
            setLanguage(language);
            storeLanguage(language);
          }}
        >
          {LANGUAGE_NAMES[language]}
        </button>
      ))}
    </fieldset>
  );
}
