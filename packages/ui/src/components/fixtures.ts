import type { PlaceCardPayload } from '../payloads';
import type { PlaceLabels } from './place-carousel/PlaceCard';

/** Test data shared by the component tests. */
export const LABELS: PlaceLabels = {
  places: 'Places',
  viewCards: 'Cards',
  viewMap: 'Map',
  expandMap: 'Expand map',
  closeMap: 'Close map',
  mapUnavailable: 'The map could not load.',
  photoOf: (title) => `Photo of ${title}`,
  photoCredit: (credit) => `Photo: ${credit}`,
  km: (n) => `${n} km away`,
  minutes: (n) => `${n} min away`,
  lastChecked: (iso) => `Last checked ${iso.slice(0, 7)} · call ahead`,
  unverified: 'Call ahead to check',
  hostPick: "Your host's pick",
  save: 'Save',
  saved: 'Saved',
};

export const place = (over: Partial<PlaceCardPayload> = {}): PlaceCardPayload => ({
  id: 'p1',
  kind: 'place',
  category: 'restaurant',
  title: 'Konoba Mala',
  summary: 'Grilled fish by the harbour.',
  location: { lat: 43.517, lng: 16.251 },
  distanceKm: 0.43,
  travelMinutes: null,
  image: null,
  verifiedAt: null,
  staleness: { status: 'fresh' },
  ...over,
});
