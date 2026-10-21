import { describe, expect, it } from 'vitest';
import { type RankCandidate, rankPlaces } from '../catalog/ranking';
import { aboutMeFit, INTEREST_CATEGORIES } from './fit';
import { EMPTY_ABOUT_ME, INTERESTS } from './vocabulary';

describe('aboutMeFit', () => {
  it('is null with no interests', () => {
    expect(aboutMeFit(EMPTY_ABOUT_ME)).toBeNull();
    expect(aboutMeFit({ ...EMPTY_ABOUT_ME, party: 'family', needs: ['halal'] })).toBeNull();
  });

  it('takes the strongest pull per category, not the sum', () => {
    expect(aboutMeFit({ ...EMPTY_ABOUT_ME, interests: ['food', 'nightlife'] })).toEqual({
      categoryWeights: { restaurant: 1, cafe_bar: 0.5, nightlife: 1 },
    });
  });

  it('maps every interest to weights in (0, 1]', () => {
    expect(Object.keys(INTEREST_CATEGORIES).sort()).toEqual([...INTERESTS].sort());
    for (const weights of Object.values(INTEREST_CATEGORIES)) {
      const values = Object.values(weights);
      expect(values.length).toBeGreaterThan(0);
      for (const w of values) {
        expect(w).toBeGreaterThan(0);
        expect(w).toBeLessThanOrEqual(1);
      }
    }
  });

  it('turns the ranking of otherwise equal places', () => {
    const sight: RankCandidate = {
      id: 'sight',
      category: 'sight',
      textScore: null,
      staleness: 'fresh',
      distanceM: 500,
    };
    const beach: RankCandidate = { ...sight, id: 'beach', category: 'beach', distanceM: 4000 };
    const ids = (list: RankCandidate[]) => list.map((c) => c.id);
    expect(ids(rankPlaces([beach, sight], null))).toEqual(['sight', 'beach']);
    const fit = aboutMeFit({ ...EMPTY_ABOUT_ME, interests: ['beaches'] });
    expect(ids(rankPlaces([sight, beach], fit))).toEqual(['beach', 'sight']);
  });
});
