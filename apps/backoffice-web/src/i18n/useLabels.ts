import { useTranslation } from 'react-i18next';
import { i18next, locales } from './index';
import type { Messages } from './locales/en';

export type Labels = Messages['labels'];

/** Every label map (amenities, statuses, …) in a language; English for any other code. */
export function labelsFor(language: string): Labels {
  return language === 'hr' ? locales.hr.labels : locales.en.labels;
}

/** The label maps in the interface language; the component re-renders when it changes. */
export function useLabels(): Labels {
  const { i18n } = useTranslation('labels');
  return labelsFor(i18n.language);
}

/** The label maps in the interface language, for helpers that run during a render. */
export const currentLabels = (): Labels => labelsFor(i18next.language);
