import { WIZARD_COPY, type WizardCopy } from '@fetivi/domain/wizard';
import { useSession } from '../../session';

/** The wizard copy in the viewer's own language; an acting admin sees theirs, not the host's. */
export function useWizardCopy(): WizardCopy {
  const { me } = useSession();
  const language = me && me !== 'loading' ? me.account.language : 'en';
  return WIZARD_COPY[language] ?? WIZARD_COPY.en;
}

/** Fills `{name}` placeholders. */
export function format(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}
