import { GUEST_LANGUAGES, type GuestLanguage } from '@fetivi/domain/vocabulary';
import { Check } from '@phosphor-icons/react';
import type { Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { LANGUAGE_NAMES } from '../i18n/languages';
import { FetiviStage } from './FetiviStage';

/** The seven languages in a fixed order, each under its own name; the current one has the check. */
export function LanguageOptions({
  current,
  onPick,
}: {
  current?: GuestLanguage;
  onPick: (language: GuestLanguage) => void;
}) {
  return (
    <ul className="language-list">
      {GUEST_LANGUAGES.map((code) => (
        <li key={code}>
          <button
            type="button"
            className="language-option"
            aria-current={code === current ? 'true' : undefined}
            onClick={() => onPick(code)}
          >
            <span className="language-name">
              <span lang={code}>{LANGUAGE_NAMES[code]}</span>
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
  onPick,
  headingRef,
}: {
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
      <LanguageOptions onPick={onPick} />
    </>
  );
}
