import { GUEST_LANGUAGES, type GuestLanguage } from '@fetivi/domain/vocabulary';
import { Check } from '@phosphor-icons/react';
import type { Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { navigatorLanguages, pickBrowserLanguage } from '../i18n/browser-language';
import { LANGUAGE_NAMES } from '../i18n/languages';
import { FetiviStage } from './FetiviStage';

/**
 * The seven languages in a fixed order, each under its own name. The phone's one carries a small
 * caption, not the check: only the current language looks chosen.
 */
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
            <span className="language-name">
              <span lang={code}>{LANGUAGE_NAMES[code]}</span>
              {code === marked && code !== current && markedNote && (
                <span className="language-suggested" lang={i18n.language}>
                  {markedNote}
                </span>
              )}
            </span>
            {code === current && (
              <span className="note">
                <Check aria-hidden="true" weight="bold" />
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
      <FetiviStage>
        <h1 ref={headingRef} tabIndex={-1}>
          {t('picker.mascot')}
        </h1>
      </FetiviStage>
      <LanguageOptions
        marked={pickBrowserLanguage(browserLanguages)}
        markedNote={t('picker.yourLanguage')}
        onPick={onPick}
      />
    </>
  );
}
