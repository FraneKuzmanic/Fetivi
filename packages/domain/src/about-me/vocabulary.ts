// About me codes. Imports nothing: the guest SPA bundles this file through the
// `@fetivi/domain/about-me-vocabulary` subpath, and the pgEnums are built from it.
// Arrays are in display order; stored lists follow the same order.

export const PARTY_SHAPES = ['solo', 'couple', 'family', 'friends', 'group'] as const;
export type PartyShape = (typeof PARTY_SHAPES)[number];

export const INTERESTS = [
  'beaches',
  'sights',
  'food',
  'nature',
  'day_trips',
  'active',
  'nightlife',
  'shopping',
  'slow',
] as const;
export type Interest = (typeof INTERESTS)[number];

export const PACES = ['easy', 'mixed', 'full'] as const;
export type Pace = (typeof PACES)[number];

export const BUDGETS = ['simple', 'mid', 'treat'] as const;
export type Budget = (typeof BUDGETS)[number];

/** How the guests get around. */
export const TRANSPORTS = ['car', 'scooter_bike', 'foot_transit'] as const;
export type Transport = (typeof TRANSPORTS)[number];

/** Special-category (GDPR Art. 9: health). Saved only by the guest's own tap, never through a tool. */
export const NEEDS = ['gluten_free', 'food_allergy', 'step_free', 'limited_mobility'] as const;
export type Need = (typeof NEEDS)[number];

/** What is kept about a Space's guests. Fixed codes only: no names, no free text. */
export interface AboutMe {
  party: PartyShape | null;
  /** Unique, in INTERESTS order. */
  interests: Interest[];
  pace: Pace | null;
  budget: Budget | null;
  transport: Transport | null;
  /** Unique, in NEEDS order; special-category. */
  needs: Need[];
}

/** What the model may change (update_about_me): never `needs`. */
export interface AboutMePatch {
  party?: PartyShape | null;
  addInterests?: Interest[];
  removeInterests?: Interest[];
  pace?: Pace | null;
  budget?: Budget | null;
  transport?: Transport | null;
}

export const EMPTY_ABOUT_ME: AboutMe = {
  party: null,
  interests: [],
  pace: null,
  budget: null,
  transport: null,
  needs: [],
};

/** True when nothing at all is saved. */
export function isAboutMeEmpty(a: AboutMe): boolean {
  return (
    a.party === null &&
    a.interests.length === 0 &&
    a.pace === null &&
    a.budget === null &&
    a.transport === null &&
    a.needs.length === 0
  );
}
