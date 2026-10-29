// The labelled guest queries that tune RELEVANCE (61). The recorder embeds each query and avoid
// with Voyage; the fixture test scores them against the recorded Trogir catalog.

/** A recorded record: catalog place, day trip, event, transport note, or host-added place. */
export interface FixtureRecord {
  id: string;
  /** The English title, as the expectations name it. */
  name: string;
  kind: 'place' | 'day_trip' | 'event' | 'transport_note' | 'host_added';
  category: string | null;
  /** The admin marked it good on a rainy day (host-added places never are). */
  rainyDay: boolean;
}

export type Expectation =
  /** This record ranks first. */
  | { first: string }
  /** This record is among the first `top` matches. */
  | { top: number; includes: string }
  /** This record matches but does not rank first. */
  | { notFirst: string }
  /** Something matches, and every one of the first `top` matches passes `every`. */
  | { top: number; every: (r: FixtureRecord) => boolean; label: string }
  /** At least one of the first `top` matches passes `some`. */
  | { top: number; some: (r: FixtureRecord) => boolean; label: string }
  /** Nothing matches. */
  | { none: true };

export interface RelevanceCase {
  /** No query: every candidate matches, in no particular order (search's no-words path). */
  query?: string;
  avoid?: string;
  /** Which records the tool searches: search_places's (default) or every kind. */
  among?: 'places' | 'all';
  /** search_places's rainyDay input: only rainy-day records. */
  rainyDay?: boolean;
  expect: Expectation[];
}

const isRestaurant = (r: FixtureRecord) => r.category === 'restaurant';
const notNightlife = (r: FixtureRecord) => r.category !== 'nightlife';
const outdoorsy = (r: FixtureRecord) => r.category === 'beach' || r.category === 'nature';
const isSight = (r: FixtureRecord) => r.category === 'sight';

export const RELEVANCE_CASES: RelevanceCase[] = [
  { query: 'fresh fish', expect: [{ top: 2, includes: 'Konoba Mala' }] },
  { query: 'grilled fish tonight', expect: [{ top: 2, includes: 'Konoba Mala' }] },
  { query: 'riba', expect: [{ top: 2, includes: 'Konoba Mala' }] },
  { query: 'Fisch', expect: [{ top: 2, includes: 'Konoba Mala' }] },
  {
    query: 'vegetarian, kids hate fish',
    avoid: 'fish',
    expect: [{ notFirst: 'Konoba Mala' }],
  },
  {
    query: 'romantic dinner',
    expect: [{ top: 3, every: isRestaurant, label: 'restaurants only' }],
  },
  {
    query: 'something for kids',
    expect: [
      { top: 3, every: notNightlife, label: 'no nightlife' },
      { top: 3, some: outdoorsy, label: 'a beach or nature place' },
    ],
  },
  // "What can we do when it rains?": rain is the rainyDay input, not words (no record's text
  // mentions rain or indoors).
  { rainyDay: true, expect: [{ top: 3, some: isSight, label: 'a sight' }] },
  { query: 'pizza', expect: [{ first: 'Pizzeria Kampanel' }] },
  { query: 'Kamerlengo', expect: [{ first: 'Kamerlengo Fortress' }] },
  { query: 'Konoba Mala', expect: [{ first: 'Konoba Mala' }] },
  { query: 'bus 37', among: 'all', expect: [{ first: 'Split–Trogir city bus 37' }] },
  { query: 'xqzt vlorp', expect: [{ none: true }] },
  // The chat test's queries (findings F1).
  { query: 'fresh fish seafood', expect: [{ top: 2, includes: 'Konoba Mala' }] },
  { query: 'vegetarian pizza pasta', expect: [{ top: 2, includes: 'Pizzeria Kampanel' }] },
  { query: 'family kids', expect: [{ top: 3, every: notNightlife, label: 'no nightlife' }] },
];
