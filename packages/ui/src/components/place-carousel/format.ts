import type { PlaceCardPayload } from '../../payloads';

/**
 * How far a place (or an event) is: travel time for a day trip, otherwise km (one decimal under
 * 10 km, at least 0.1).
 */
export function distanceText(
  place: {
    kind?: PlaceCardPayload['kind'];
    distanceKm: number | null;
    travelMinutes?: number | null;
  },
  labels: { km: (distance: number) => string; minutes: (minutes: number) => string },
): string | null {
  if (place.kind === 'day_trip' && place.travelMinutes != null) {
    return labels.minutes(Math.round(place.travelMinutes));
  }
  if (place.distanceKm === null) return null;
  const km = place.distanceKm;
  // Never "0 km": anything closer than 100 m reads as 0.1 km.
  return labels.km(km < 10 ? Math.max(0.1, Math.round(km * 10) / 10) : Math.round(km));
}

export type LastCheckedNote = { kind: 'stale'; verifiedAt: string } | { kind: 'unverified' };

/**
 * A card says when it was last checked only past the staleness budget (PRD §6.3): a fresh place
 * shows nothing, a stale one its check month, an unchecked one a call-ahead hint. A host-added
 * place has none: the host vouches for it.
 */
export function lastCheckedNote(
  place: Pick<PlaceCardPayload, 'staleness' | 'verifiedAt' | 'hostAdded'>,
): LastCheckedNote | null {
  if (place.hostAdded) return null;
  const { status } = place.staleness;
  if (status === 'stale' && place.verifiedAt)
    return { kind: 'stale', verifiedAt: place.verifiedAt };
  if (status === 'stale' || status === 'never_verified') return { kind: 'unverified' };
  return null;
}
