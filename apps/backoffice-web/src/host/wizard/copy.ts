import { WIZARD_COPY, type WizardCopy } from '@fetivi/domain/wizard';
import { useTranslation } from 'react-i18next';
import { isBackofficeLanguage } from '../../i18n/browser-language';

/** The wizard copy in the interface language; an acting admin sees theirs, not the host's. */
export function useWizardCopy(): WizardCopy {
  const { i18n } = useTranslation();
  return WIZARD_COPY[isBackofficeLanguage(i18n.language) ? i18n.language : 'en'];
}

/** Fills `{name}` placeholders. */
export function format(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}
