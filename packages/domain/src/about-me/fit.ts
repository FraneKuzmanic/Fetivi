import type { AboutMeFit } from '../catalog/ranking';
import type { PlaceCategory } from '../catalog/vocabulary';
import type { AboutMe, Interest } from './vocabulary';

type CategoryWeights = Partial<Record<PlaceCategory | 'day_trip', number>>;

/** How much each interest pulls a Place category up in ranking (0–1). */
export const INTEREST_CATEGORIES: Record<Interest, CategoryWeights> = {
  beaches: { beach: 1 },
  sights: { sight: 1 },
  food: { restaurant: 1, cafe_bar: 0.5 },
  nature: { nature: 1 },
  day_trips: { day_trip: 1 },
  active: { activity: 1 },
  nightlife: { nightlife: 1, cafe_bar: 0.5 },
  shopping: { shop: 1 },
  slow: { beach: 0.5, cafe_bar: 0.5 },
};

/**
 * The ranking signal from About me: per category, the strongest pull of any interest. Null with no
 * interests. Party, pace, budget, transport and needs don't rank (the catalog has no such data);
 * they reach the model through the About me note.
 */
export function aboutMeFit(a: AboutMe): AboutMeFit | null {
  if (a.interests.length === 0) return null;
  const categoryWeights: CategoryWeights = {};
  for (const interest of a.interests) {
    for (const [category, weight] of Object.entries(INTEREST_CATEGORIES[interest])) {
      const key = category as keyof CategoryWeights;
      categoryWeights[key] = Math.max(categoryWeights[key] ?? 0, weight);
    }
  }
  return { categoryWeights };
}
