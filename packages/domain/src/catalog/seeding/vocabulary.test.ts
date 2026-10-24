import { describe, expect, it } from 'vitest';
import { OPEN_DATA_SOURCES, PLACE_CATEGORIES } from '../vocabulary';
import {
  BATHING_WATER_ENDPOINT,
  OSM_CATEGORY_RULES,
  OVERPASS_ENDPOINT,
  OVERTURE_CATEGORY_KEYWORDS,
  OVERTURE_STAC_ROOT,
  SEEDING_HOSTS,
  SEEDING_SOURCES,
} from './vocabulary';

describe('seeding vocabulary', () => {
  it('uses only open-data source codes', () => {
    for (const source of SEEDING_SOURCES) expect(OPEN_DATA_SOURCES).toContain(source);
  });

  it('maps only to place categories', () => {
    for (const rule of [...OSM_CATEGORY_RULES, ...OVERTURE_CATEGORY_KEYWORDS]) {
      expect(PLACE_CATEGORIES).toContain(rule.category);
    }
  });

  it('lists the host of every endpoint', () => {
    for (const url of [OVERPASS_ENDPOINT, BATHING_WATER_ENDPOINT, OVERTURE_STAC_ROOT]) {
      expect(SEEDING_HOSTS).toContain(new URL(url).hostname);
    }
  });
});
