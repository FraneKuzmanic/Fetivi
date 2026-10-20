import {
  CATALOG_KINDS,
  IMAGE_SOURCES,
  PLACE_CATEGORIES,
  SOURCE_FIELDS,
  STALENESS_STATUSES,
  TRANSPORT_MODES,
} from '@fetivi/domain/catalog-vocabulary';
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
import {
  AMENITY_LABELS,
  BED_LABELS,
  CATALOG_KIND_LABELS,
  CATEGORY_LABELS,
  CHECK_IN_METHOD_LABELS,
  CORE_FIELD_LABELS,
  IMAGE_SOURCE_LABELS,
  LANGUAGE_LABELS,
  PARKING_LABELS,
  PLACE_CATEGORY_LABELS,
  SOURCE_FIELD_LABELS,
  STALENESS_LABELS,
  TRANSLATION_ERROR_LABELS,
  TRANSLATION_ORIGIN_LABELS,
  TRANSLATION_STATUS_LABELS,
  TRANSPORT_MODE_LABELS,
  VISIBILITY_LABELS,
  WEEKDAY_LABELS,
} from './labels';

const ALL_SOURCE_FIELDS = [...new Set(Object.values(SOURCE_FIELDS).flat())];

describe('labels', () => {
  it.each([
    ['amenities', AMENITIES, AMENITY_LABELS],
    ['bed types', BED_TYPES, BED_LABELS],
    ['block categories', BLOCK_CATEGORIES, CATEGORY_LABELS],
    ['visibility', BLOCK_VISIBILITY, VISIBILITY_LABELS],
    ['check-in methods', CHECK_IN_METHODS, CHECK_IN_METHOD_LABELS],
    ['parking', PARKING_TYPES, PARKING_LABELS],
    ['core fields', SHARED_CORE_FIELDS, CORE_FIELD_LABELS],
    ['guest languages', GUEST_LANGUAGES, LANGUAGE_LABELS],
    ['translation statuses', TRANSLATION_STATUSES, TRANSLATION_STATUS_LABELS],
    ['translation errors', TRANSLATION_ERRORS, TRANSLATION_ERROR_LABELS],
    ['translation origins', TRANSLATION_ORIGINS, TRANSLATION_ORIGIN_LABELS],
    ['catalog kinds', CATALOG_KINDS, CATALOG_KIND_LABELS],
    ['place categories', PLACE_CATEGORIES, PLACE_CATEGORY_LABELS],
    ['transport modes', TRANSPORT_MODES, TRANSPORT_MODE_LABELS],
    ['image sources', IMAGE_SOURCES, IMAGE_SOURCE_LABELS],
    ['staleness statuses', STALENESS_STATUSES, STALENESS_LABELS],
    ['source fields', ALL_SOURCE_FIELDS, SOURCE_FIELD_LABELS],
    ['weekdays', [1, 2, 3, 4, 5, 6, 7], WEEKDAY_LABELS],
  ] as const)('names every value of %s', (_name, values, labels) => {
    for (const value of values) {
      expect((labels as Record<string, string>)[value]?.trim()).toBeTruthy();
    }
  });
});
