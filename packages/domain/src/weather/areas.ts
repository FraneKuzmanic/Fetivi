import { WEATHER_LIMITS } from './vocabulary';

// Static data that ties a property to DHMZ's stations and warning areas. DHMZ CAP warnings carry
// region codes (MeteoAlarm EMMA_IDs), not polygons, so a property's warning areas come from the
// nearest coastal reference town. That approximates county borders: only the pilot area
// (Trogir, Split) is checked exactly. Another destination adds rows here, nothing else.
// Coordinates are approximate, good to about 2 km.

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface Station extends GeoPoint {
  /** The name as the DHMZ feed shows it. */
  name: string;
}

export interface WarningAreaPoint extends GeoPoint {
  town: string;
  /** County EMMA_ID, e.g. HR027 Splitsko-dalmatinska. */
  county: string;
  /** Marine region EMMA_ID, e.g. HR805 Middle Dalmatia; null inland. */
  marine: string | null;
}

const EARTH_RADIUS_KM = 6371;

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** `items` within `maxKm` of `point`, nearest first. */
export function byDistance<T extends GeoPoint>(
  items: readonly T[],
  point: GeoPoint,
  maxKm: number,
): T[] {
  return items
    .map((item) => ({ item, km: haversineKm(item, point) }))
    .filter(({ km }) => km <= maxKm)
    .sort((a, b) => a.km - b.km)
    .map(({ item }) => item);
}

/** The item nearest `point`, or null when none is within `maxKm`. */
export function nearest<T extends GeoPoint>(
  items: readonly T[],
  point: GeoPoint,
  maxKm: number,
): T | null {
  return byDistance(items, point, maxKm)[0] ?? null;
}

/** Lowercase, no diacritics, single spaces: the feed writes "Mali Losinj", the table "Mali Lošinj". */
export function normaliseStation(name: string): string {
  return name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Sea temperature stations on the open sea. The two Mljet lakes are left out. */
export const SEA_STATIONS: readonly Station[] = [
  { name: 'Božava', lat: 44.14, lng: 14.91 },
  { name: 'Crikvenica', lat: 45.17, lng: 14.69 },
  { name: 'Dubrovnik', lat: 42.65, lng: 18.09 },
  { name: 'Komiža', lat: 43.04, lng: 16.09 },
  { name: 'Mali Lošinj', lat: 44.53, lng: 14.47 },
  { name: 'Malinska', lat: 45.12, lng: 14.53 },
  { name: 'Mljet-otvoreno more', lat: 42.75, lng: 17.38 },
  { name: 'Opatija', lat: 45.34, lng: 14.31 },
  { name: 'Pula', lat: 44.87, lng: 13.85 },
  { name: 'Rab', lat: 44.76, lng: 14.76 },
  { name: 'Rovinj-Sv.Ivan n/p', lat: 45.04, lng: 13.62 },
  { name: 'Split', lat: 43.51, lng: 16.44 },
  { name: 'Šibenik', lat: 43.73, lng: 15.89 },
  { name: 'Zadar', lat: 44.12, lng: 15.23 },
];

/**
 * UV stations. A station in the feed that is missing here is ignored: add a row when DHMZ adds
 * a station (summer brings more coastal ones).
 */
export const UV_STATIONS: readonly Station[] = [
  ...SEA_STATIONS,
  { name: 'Hvar', lat: 43.17, lng: 16.44 },
  { name: 'Makarska', lat: 43.3, lng: 17.02 },
];

const point = (
  town: string,
  lat: number,
  lng: number,
  county: string,
  marine: string | null,
): WarningAreaPoint => ({ town, lat, lng, county, marine });

/** Coastal reference towns → county and marine region EMMA_IDs. */
export const WARNING_AREA_POINTS: readonly WarningAreaPoint[] = [
  // Istria
  point('Umag', 45.43, 13.52, 'HR028', 'HR801'),
  point('Poreč', 45.23, 13.59, 'HR028', 'HR801'),
  point('Rovinj', 45.08, 13.64, 'HR028', 'HR801'),
  point('Pula', 44.87, 13.85, 'HR028', 'HR801'),
  point('Rabac', 45.08, 14.15, 'HR028', 'HR802'),
  // Kvarner
  point('Opatija', 45.34, 14.31, 'HR018', 'HR802'),
  point('Rijeka', 45.33, 14.44, 'HR018', 'HR802'),
  point('Crikvenica', 45.17, 14.69, 'HR018', 'HR802'),
  point('Krk', 45.03, 14.58, 'HR018', 'HR802'),
  point('Cres', 44.96, 14.41, 'HR018', 'HR802'),
  point('Mali Lošinj', 44.53, 14.47, 'HR018', 'HR802'),
  point('Rab', 44.76, 14.76, 'HR018', 'HR803'),
  // Velebit channel
  point('Senj', 44.99, 14.9, 'HR019', 'HR803'),
  point('Novalja', 44.56, 14.89, 'HR019', 'HR803'),
  point('Pag', 44.44, 15.06, 'HR023', 'HR803'),
  // North Dalmatia
  point('Zadar', 44.12, 15.23, 'HR023', 'HR804'),
  point('Božava', 44.14, 14.91, 'HR023', 'HR804'),
  point('Biograd', 43.94, 15.45, 'HR023', 'HR804'),
  point('Vodice', 43.76, 15.78, 'HR025', 'HR804'),
  point('Šibenik', 43.73, 15.89, 'HR025', 'HR804'),
  point('Primošten', 43.59, 15.92, 'HR025', 'HR804'),
  // Middle Dalmatia
  point('Rogoznica', 43.53, 15.97, 'HR025', 'HR805'),
  point('Trogir', 43.52, 16.25, 'HR027', 'HR805'),
  point('Split', 43.51, 16.44, 'HR027', 'HR805'),
  point('Supetar', 43.38, 16.55, 'HR027', 'HR805'),
  point('Omiš', 43.44, 16.69, 'HR027', 'HR805'),
  point('Makarska', 43.3, 17.02, 'HR027', 'HR805'),
  point('Hvar', 43.17, 16.44, 'HR027', 'HR805'),
  point('Komiža', 43.04, 16.09, 'HR027', 'HR805'),
  // South Dalmatia
  point('Ploče', 43.05, 17.43, 'HR029', 'HR806'),
  point('Korčula', 42.96, 17.14, 'HR029', 'HR806'),
  point('Ston', 42.84, 17.7, 'HR029', 'HR806'),
  point('Mljet', 42.75, 17.53, 'HR029', 'HR806'),
  point('Dubrovnik', 42.65, 18.09, 'HR029', 'HR806'),
  point('Cavtat', 42.58, 18.22, 'HR029', 'HR806'),
];

/**
 * The EMMA_IDs whose warnings apply at `place`: county, then marine region. Null when no
 * reference town is close enough; the warnings are then unknown, never "none".
 */
export function warningAreasAt(place: GeoPoint): string[] | null {
  const ref = nearest(WARNING_AREA_POINTS, place, WEATHER_LIMITS.maxAreaKm);
  if (!ref) return null;
  return ref.marine ? [ref.county, ref.marine] : [ref.county];
}
