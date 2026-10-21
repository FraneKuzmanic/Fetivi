import type { PropertyInfoLabels } from '@fetivi/ui';
import type { TFunction } from 'i18next';

const YES_NO_FIELDS = new Set(['pets', 'smoking', 'parties']);

/** The property info card's strings; the release time is shown in the property's zone. */
export function propertyInfoLabels(t: TFunction, language: string): PropertyInfoLabels {
  return {
    title: (topic) => t(`info.topic_${topic}`),
    field: (key) => t(`info.field_${key}`),
    value: (key, raw) => {
      if (key === 'checkInMethod') return t(`info.method_${raw}`, { defaultValue: raw });
      if (YES_NO_FIELDS.has(key)) return t(raw === 'yes' ? 'info.yes' : 'info.no');
      return raw;
    },
    releaseNote: (releaseAt, timeZone) => {
      const when = new Intl.DateTimeFormat(language, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        timeZone,
      }).format(new Date(releaseAt));
      return t('info.releaseNote', { when });
    },
    noWifi: t('info.noWifi'),
    copy: (label) => t('info.copy', { label }),
    copied: t('info.copied'),
    copyFailed: t('info.copyFailed'),
    call: (label) => t('info.call', { label }),
  };
}
