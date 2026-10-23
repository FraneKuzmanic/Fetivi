import type { GuestProjection } from '@fetivi/domain/projection-types';
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
  hostAdded: 'Added by your host',
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

/** A guest projection with every field set; `released` opens the gated ones. */
export function projection(
  released: boolean,
  over: Partial<GuestProjection> = {},
): GuestProjection {
  return {
    language: 'en',
    property: {
      name: 'Villa Mare',
      addressLine: 'Obala 1',
      city: 'Trogir',
      postalCode: '21220',
      country: 'HR',
      timezone: 'Europe/Zagreb',
      location: null,
    },
    unit: { name: 'Apartment 1', maxOccupancy: 4, bedrooms: 2, beds: [], bathrooms: 1 },
    stay: {
      checkIn: '2026-10-21',
      checkout: '2026-10-24',
      partySize: 2,
      arrivalDetailsReleased: released,
      arrivalDetailsReleaseAt: '2026-10-19T22:00:00.000Z',
    },
    checkInOut: { checkInTime: '15:00:00', checkoutTime: '10:00:00', checkInMethod: 'lockbox' },
    arrival: released
      ? {
          accessInstructions: 'Blue gate, second floor.',
          buildingDoorCode: 'B-1234',
          doorCode: null,
          lockboxCode: 'L-9020',
        }
      : null,
    wifi: { network: 'Mare', password: released ? 'sea-breeze-55' : null },
    parking: { type: 'free_street', notes: null },
    houseRules: {
      petsAllowed: false,
      smokingAllowed: null,
      partiesAllowed: false,
      quietHoursFrom: '22:00:00',
      quietHoursTo: '08:00:00',
      notes: 'Shoes off inside.',
    },
    contacts: {
      hostPhone: released ? '+385 91 000 1111' : null,
      emergencyContactName: 'Ana',
      emergencyContactPhone: released ? '+385 91 000 2222' : null,
    },
    amenities: [{ amenity: 'washer', note: null }],
    blocks: [],
    ...over,
  };
}
