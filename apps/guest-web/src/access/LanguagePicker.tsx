import { GUEST_LANGUAGES, type GuestLanguage } from '@fetivi/domain/vocabulary';
import { Check } from '@phosphor-icons/react';
import type { Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { navigatorLanguages, pickBrowserLanguage } from '../i18n/browser-language';
import { LANGUAGE_NAMES } from '../i18n/languages';
import { MascotSays } from '../shell/Mascot';

/** The seven languages in a fixed order, each under its own name; the phone's one is marked. */
export function LanguageOptions({
  marked,
  markedNote,
  current,
  onPick,
}: {
  marked?: GuestLanguage;
  markedNote?: string;
  current?: GuestLanguage;
  onPick: (language: GuestLanguage) => void;
}) {
  const { i18n } = useTranslation();
  return (
    <ul className="language-list">
      {GUEST_LANGUAGES.map((code) => (
        <li key={code}>
          <button
            type="button"
            className="language-option"
            data-suggested={code === marked ? 'true' : undefined}
            aria-current={code === current ? 'true' : undefined}
            onClick={() => onPick(code)}
          >
            <span lang={code}>{LANGUAGE_NAMES[code]}</span>
            {(code === marked || code === current) && (
              <span className="note">
                <Check aria-hidden="true" weight="bold" />
                {code === marked && markedNote && (
                  <span className="visually-hidden" lang={i18n.language}>
                    {markedNote}
                  </span>
                )}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function LanguagePicker({
  browserLanguages = navigatorLanguages(),
  onPick,
  headingRef,
}: {
  browserLanguages?: readonly string[];
  onPick: (language: GuestLanguage) => void;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const { t } = useTranslation();
  return (
    <>
      <h1 ref={headingRef} tabIndex={-1}>
        {t('picker.title')}
      </h1>
      <MascotSays>{t('picker.mascot')}</MascotSays>
      <LanguageOptions
        marked={pickBrowserLanguage(browserLanguages)}
        markedNote={t('picker.yourLanguage')}
        onPick={onPick}
      />
    </>
  );
}
