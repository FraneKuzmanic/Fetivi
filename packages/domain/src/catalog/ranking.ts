import type { PlaceCategory, StalenessStatus } from './vocabulary';

/** The About me signal ranking accepts; ticket 12 maps the Space's preferences to it. Weights 0–1. */
export interface AboutMeFit {
  categoryWeights: Partial<Record<PlaceCategory | 'day_trip', number>>;
}

export interface RankCandidate {
  id: string;
  category: PlaceCategory | 'day_trip';
  /** 0–1 trigram match to the guest's words; null when the request had no words. */
  textScore: number | null;
  staleness: StalenessStatus;
  distanceM: number | null;
}

/** Fit first (request, then About me), then quality, then distance. No bookable boost yet (16); never commission. */
export const RANKING_WEIGHTS = { text: 0.5, aboutMe: 0.2, quality: 0.2, proximity: 0.1 } as const;

const QUALITY: Record<StalenessStatus, number> = {
  fresh: 1,
  stale: 0.4,
  never_verified: 0,
  expired: 0,
};

/** 1 at the door, 0.5 at 3 km, 0 when unknown. */
const proximity = (m: number | null) => (m === null ? 0 : 1 / (1 + m / 3000));
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** A candidate's weighted score; higher is better. */
export function scoreOf(c: RankCandidate, aboutMe: AboutMeFit | null): number {
  const w = RANKING_WEIGHTS;
  return (
    w.text * (c.textScore ?? 0) +
    w.aboutMe * clamp01(aboutMe?.categoryWeights[c.category] ?? 0) +
    w.quality * QUALITY[c.staleness] +
    w.proximity * proximity(c.distanceM)
  );
}

/** Best first; ties by distance (unknown last), then id, so the order is deterministic. */
export function rankPlaces<T extends RankCandidate>(
  candidates: T[],
  aboutMe: AboutMeFit | null,
): T[] {
  return candidates
    .map((c) => ({ c, score: scoreOf(c, aboutMe) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.c.distanceM ?? Number.POSITIVE_INFINITY) - (b.c.distanceM ?? Number.POSITIVE_INFINITY) ||
        (a.c.id < b.c.id ? -1 : a.c.id > b.c.id ? 1 : 0),
    )
    .map(({ c }) => c);
}
