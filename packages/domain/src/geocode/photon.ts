import type { Egress } from '@fetivi/egress';
import { GEOCODE_LIMITS, type GeocodeKind, type GeoPlace } from './vocabulary';

// Photon (https://photon.komoot.io): an OSM geocoder that allows search as you type. Results are
// cached for a day; a host types the same address a few times at most.

export interface Geocoder {
  /**
   * Addresses and places matching `query`, the ones near `near` first. `settlement` keeps towns
   * and villages only, for the City field.
   */
  search(
    query: string,
    options?: { near?: { lat: number; lng: number }; kind?: GeocodeKind },
  ): Promise<GeoPlace[]>;
  /** The address at a point, for a pin the host dragged; null when there is none. */
  reverse(lat: number, lng: number): Promise<GeoPlace | null>;
}

export class GeocoderError extends Error {
  override name = 'GeocoderError';
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    osm_key?: string;
    type?: string;
    name?: string;
    street?: string;
    housenumber?: string;
    postcode?: string;
    city?: string;
    town?: string;
    village?: string;
    locality?: string;
    district?: string;
    country?: string;
    countrycode?: string;
  };
}

const PLACE_TYPES = new Set(['city', 'town', 'village', 'hamlet', 'locality', 'district']);

/** One Photon feature as a place a host can pick. */
export function placeOf(feature: PhotonFeature): GeoPlace {
  const p = feature.properties;
  const [lng, lat] = feature.geometry.coordinates;
  const isSettlement = p.osm_key === 'place' || PLACE_TYPES.has(p.type ?? '');
  const isStreet = p.type === 'street';
  const street = isStreet ? (p.name ?? null) : (p.street ?? null);
  const addressLine = street ? [street, p.housenumber].filter(Boolean).join(' ') : null;
  const settlementName = isSettlement ? p.name : undefined;
  const city = p.city ?? p.town ?? p.village ?? settlementName ?? p.locality ?? null;
  // A named building or business leads its own line; a bare street or town needs no extra name.
  const name = !isStreet && !isSettlement && p.name ? p.name : null;
  const label = [name, addressLine, [p.postcode, city].filter(Boolean).join(' ') || null, p.country]
    .filter(Boolean)
    .join(', ');
  return {
    label,
    addressLine,
    city,
    postalCode: p.postcode ?? null,
    country: p.countrycode ? p.countrycode.toUpperCase() : null,
    lat,
    lng,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_SIZE = 500;

export function createPhotonGeocoder(options: {
  fetch: Egress['fetch'];
  userAgent: string;
  baseUrl?: string;
  now?: () => number;
}): Geocoder {
  const base = options.baseUrl ?? 'https://photon.komoot.io';
  const now = options.now ?? Date.now;
  const cache = new Map<string, { at: number; value: unknown }>();

  async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = cache.get(key);
    if (hit && now() - hit.at < DAY_MS) return hit.value as T;
    const value = await load();
    cache.set(key, { at: now(), value });
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
    return value;
  }

  async function features(path: string, params: [string, string][]): Promise<GeoPlace[]> {
    const url = `${base}${path}?${new URLSearchParams(params)}`;
    let response: Response;
    try {
      response = await options.fetch(url, {
        headers: { 'user-agent': options.userAgent, accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
    } catch (error) {
      throw new GeocoderError(`photon unreachable: ${String(error)}`);
    }
    if (!response.ok) throw new GeocoderError(`photon answered ${response.status}`);
    const body = (await response.json()) as { features?: PhotonFeature[] };
    return (body.features ?? []).map(placeOf);
  }

  return {
    search: (query, { near, kind = 'address' } = {}) => {
      const q = query.trim().replace(/\s+/g, ' ');
      const params: [string, string][] = [
        ['q', q],
        ['limit', String(GEOCODE_LIMITS.results)],
      ];
      if (near) params.push(['lat', near.lat.toFixed(4)], ['lon', near.lng.toFixed(4)]);
      if (kind === 'settlement') params.push(['layer', 'city'], ['layer', 'locality']);
      return cached(`s:${kind}:${new URLSearchParams(params).toString().toLowerCase()}`, () =>
        features('/api/', params),
      );
    },
    reverse: (lat, lng) =>
      cached(`r:${lat.toFixed(5)}:${lng.toFixed(5)}`, async () => {
        const [place] = await features('/reverse', [
          ['lat', lat.toFixed(6)],
          ['lon', lng.toFixed(6)],
        ]);
        return place ?? null;
      }),
  };
}
