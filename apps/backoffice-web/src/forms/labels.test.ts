import {
  CATALOG_KINDS,
  IMAGE_SOURCES,
  PLACE_CATEGORIES,
  SOURCE_FIELDS,
  STALENESS_STATUSES,
  TRANSPORT_MODES,
} from '@fetivi/domain/catalog-vocabulary';
import {
  ADAPTER_KINDS,
  AVAILABILITY_MODES,
  CONTACT_FIELDS,
  OFFER_CATEGORIES,
  ORDER_KINDS,
  PAYMENT_MODES,
  PRICE_UNITS,
  PROVIDER_LANGUAGES,
} from '@fetivi/domain/offer-vocabulary';
import {
  AMENITIES,
  BED_TYPES,
  BLOCK_CATEGORIES,
  BLOCK_VISIBILITY,
  CHECK_IN_METHODS,
  GUEST_LANGUAGES,
  PARKING_TYPES,
  SHARED_CORE_FIELDS,
  TRANSLATION_ERRORS,
  TRANSLATION_ORIGINS,
  TRANSLATION_STATUSES,
} from '@fetivi/domain/vocabulary';
import { describe, expect, it } from 'vitest';
import { locales } from '../i18n';
import { ADAPTER_KIND_LABELS, PROVIDER_LANGUAGE_LABELS } from './labels';

const ALL_SOURCE_FIELDS = [...new Set(Object.values(SOURCE_FIELDS).flat())];

describe('labels', () => {
  it.each([
    ['amenities', AMENITIES, 'amenity'],
    ['bed types', BED_TYPES, 'bed'],
    ['block categories', BLOCK_CATEGORIES, 'category'],
    ['visibility', BLOCK_VISIBILITY, 'visibility'],
    ['check-in methods', CHECK_IN_METHODS, 'checkInMethod'],
    ['parking', PARKING_TYPES, 'parking'],
    ['core fields', SHARED_CORE_FIELDS, 'coreField'],
    ['guest languages', GUEST_LANGUAGES, 'language'],
    ['translation statuses', TRANSLATION_STATUSES, 'translationStatus'],
    ['translation errors', TRANSLATION_ERRORS, 'translationError'],
    ['translation origins', TRANSLATION_ORIGINS, 'translationOrigin'],
    ['catalog kinds', CATALOG_KINDS, 'catalogKind'],
    ['place categories', PLACE_CATEGORIES, 'placeCategory'],
    ['transport modes', TRANSPORT_MODES, 'transportMode'],
    ['image sources', IMAGE_SOURCES, 'imageSource'],
    ['staleness statuses', STALENESS_STATUSES, 'staleness'],
    ['source fields', ALL_SOURCE_FIELDS, 'sourceField'],
    ['weekdays', [1, 2, 3, 4, 5, 6, 7], 'weekday'],
    ['order kinds', ORDER_KINDS, 'orderKind'],
    ['offer categories', OFFER_CATEGORIES, 'offerCategory'],
    ['availability modes', AVAILABILITY_MODES, 'availabilityMode'],
    ['availability modes (short)', AVAILABILITY_MODES, 'availabilityModeShort'],
    ['payment modes', PAYMENT_MODES, 'paymentMode'],
    ['contact fields', CONTACT_FIELDS, 'contactFields'],
    ['price units', PRICE_UNITS, 'priceUnit'],
  ] as const)('names every value of %s in en and hr', (_name, values, key) => {
    for (const code of ['en', 'hr'] as const) {
      const labels = locales[code].labels[key] as Record<string, string>;
      for (const value of values) expect(labels[value]?.trim(), `${code} ${value}`).toBeTruthy();
    }
  });

  it.each([
    ['provider languages', PROVIDER_LANGUAGES, PROVIDER_LANGUAGE_LABELS],
    ['adapter kinds', ADAPTER_KINDS, ADAPTER_KIND_LABELS],
  ] as const)('names every value of %s', (_name, values, labels) => {
    for (const value of values) {
      expect((labels as Record<string, string>)[value]?.trim()).toBeTruthy();
    }
  });
});
