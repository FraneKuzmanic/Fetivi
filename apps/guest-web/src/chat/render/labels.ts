import type { ChoiceCardLabels, PlaceLabels } from '@fetivi/ui';
import type { TFunction } from 'i18next';

/** The place components' strings in the interface language (numbers and months formatted for it). */
export function placeLabels(t: TFunction, language: string): PlaceLabels {
  const number = new Intl.NumberFormat(language, { maximumFractionDigits: 1 });
  const month = new Intl.DateTimeFormat(language, { month: 'long', year: 'numeric' });
  return {
    places: t('components.places'),
    viewCards: t('components.viewCards'),
    viewMap: t('components.viewMap'),
    expandMap: t('components.expandMap'),
    closeMap: t('components.closeMap'),
    mapUnavailable: t('components.mapUnavailable'),
    photoOf: (title) => t('components.photoOf', { title }),
    photoCredit: (credit) => t('components.photoCredit', { credit }),
    km: (distance) => t('components.km', { distance: number.format(distance) }),
    minutes: (minutes) => t('components.minutes', { minutes: number.format(minutes) }),
    lastChecked: (verifiedAt) =>
      t('components.lastChecked', { month: month.format(new Date(verifiedAt)) }),
    unverified: t('components.unverified'),
    hostPick: t('components.hostPick'),
    save: t('components.save'),
    saved: t('components.saved'),
  };
}

export const choiceLabels = (t: TFunction): ChoiceCardLabels => ({
  send: t('components.send'),
  somethingElse: t('components.somethingElse'),
});
