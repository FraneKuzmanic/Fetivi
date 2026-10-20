import {
  type CatalogKind,
  type PlaceCategory,
  STALENESS_BUDGET_DAYS,
  type StalenessKey,
  type StalenessStatus,
} from './vocabulary';

const DAY_MS = 86_400_000;

export interface StalenessInput {
  kind: CatalogKind;
  placeCategory: PlaceCategory | null;
  verifiedAt: Date | null;
  endsAt: Date | null;
}

/** The key of a record's staleness budget: a place's category, otherwise its kind. */
export function stalenessKeyOf(r: Pick<StalenessInput, 'kind' | 'placeCategory'>): StalenessKey {
  if (r.kind !== 'place') return r.kind;
  if (r.placeCategory === null) throw new Error('place without category');
  return r.placeCategory;
}

export interface Staleness {
  status: StalenessStatus;
  /** When it goes or went stale; null if never. */
  staleAt: Date | null;
}

/** The budget counts from verified_at all year round; a record never verified is past it. */
export function stalenessOf(r: StalenessInput, now: Date): Staleness {
  if (r.kind === 'event' && r.endsAt !== null && r.endsAt.getTime() <= now.getTime()) {
    return { status: 'expired', staleAt: null };
  }
  if (r.verifiedAt === null) return { status: 'never_verified', staleAt: null };
  const days = STALENESS_BUDGET_DAYS[stalenessKeyOf(r)];
  if (days === null) return { status: 'fresh', staleAt: null };
  const staleAt = new Date(r.verifiedAt.getTime() + days * DAY_MS);
  return { status: now.getTime() >= staleAt.getTime() ? 'stale' : 'fresh', staleAt };
}

export function isPastBudget(r: StalenessInput, now: Date): boolean {
  const { status } = stalenessOf(r, now);
  return status === 'stale' || status === 'never_verified';
}
