import type { AdapterKind, ProviderLanguage } from '@fetivi/domain/offer-vocabulary';

// The same in every interface language: the other label maps live in the `labels` locale
// namespace (useLabels).

/** Each Provider language under its own name. */
export const PROVIDER_LANGUAGE_LABELS: Record<ProviderLanguage, string> = {
  hr: 'Hrvatski',
  en: 'English',
};

export const ADAPTER_KIND_LABELS: Record<AdapterKind, string> = {
  bokun: 'Bókun',
};
