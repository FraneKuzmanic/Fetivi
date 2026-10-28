import { describe, expect, it } from 'vitest';
import { BLOCK_CATEGORIES, blockVisibilityOf } from './vocabulary';

describe('blockVisibilityOf', () => {
  it('holds back only arrival and access until the arrival release', () => {
    expect(Object.fromEntries(BLOCK_CATEGORIES.map((c) => [c, blockVisibilityOf(c)]))).toEqual({
      arrival_access: 'after_release',
      wifi_essentials: 'always',
      house_rules_checkout: 'always',
      how_tos: 'always',
      saved_places: 'always',
      host_picks: 'always',
      contacts_emergency: 'always',
    });
  });
});
