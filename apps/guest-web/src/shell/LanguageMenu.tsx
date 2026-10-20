import { Translate, X } from '@phosphor-icons/react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageOptions } from '../access/LanguagePicker';
import { isLanguage } from '../i18n/browser-language';
import { LANGUAGE_NAMES } from '../i18n/languages';
import { useSpace } from '../space';

/** The header button that switches the interface language at any time. */
export function LanguageMenu() {
  const { t, i18n } = useTranslation();
  const { changeLanguage } = useSpace();
  const dialog = useRef<HTMLDialogElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const current = isLanguage(i18n.language) ? i18n.language : 'en';

  return (
    <>
      <button
        ref={button}
        type="button"
        className="language-button"
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
      >
        <Translate aria-hidden="true" />
        <span className="visually-hidden">{t('header.language')}: </span>
        <span lang={current}>{LANGUAGE_NAMES[current]}</span>
      </button>
      <dialog
        ref={dialog}
        className="language-dialog"
        aria-labelledby="language-dialog-title"
        onClose={() => button.current?.focus()}
      >
        <div className="dialog-header">
          <h2 id="language-dialog-title">{t('header.chooseLanguage')}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label={t('common.close')}
            onClick={() => dialog.current?.close()}
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <LanguageOptions
          current={current}
          onPick={(language) => {
            dialog.current?.close();
            void changeLanguage(language);
          }}
        />
      </dialog>
    </>
  );
}
