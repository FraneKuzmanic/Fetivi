import { haversineKm } from '../../weather/areas';
import type { LatLng } from '../search';

// Small-distance geometry for open-data imports: a sphere is accurate enough.

export type { LatLng };

export interface Bbox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance in metres. */
export const haversineM = (a: LatLng, b: LatLng): number => haversineKm(a, b) * 1000;

/** A box around a circle, padded by 1% so points on the edge stay inside. */
export function bboxAround(centre: LatLng, radiusM: number): Bbox {
  const dLat = ((radiusM * 1.01) / EARTH_RADIUS_M) * (180 / Math.PI);
  const dLng = dLat / Math.cos((centre.lat * Math.PI) / 180);
  return {
    minLng: centre.lng - dLng,
    minLat: centre.lat - dLat,
    maxLng: centre.lng + dLng,
    maxLat: centre.lat + dLat,
  };
}

export const withinRadius = (point: LatLng, centre: LatLng, radiusM: number): boolean =>
  haversineM(point, centre) <= radiusM;
