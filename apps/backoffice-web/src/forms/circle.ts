/** A GeoJSON polygon feature, typed locally so the web app needs no GeoJSON type package. */
export interface PolygonFeature {
  type: 'Feature';
  properties: Record<string, never>;
  geometry: { type: 'Polygon'; coordinates: [number, number][][] };
}

const EARTH_RADIUS_KM = 6371;
const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/**
 * The ring of points `radiusKm` from `centre` on a sphere, closed (the last point repeats the
 * first), as [lng, lat] pairs. Draws a destination's area on the map.
 */
export function circlePolygon(
  centre: { lat: number; lng: number },
  radiusKm: number,
  steps = 64,
): PolygonFeature {
  const lat1 = rad(centre.lat);
  const lng1 = rad(centre.lng);
  const d = radiusKm / EARTH_RADIUS_KM;
  const ring: [number, number][] = [];
  for (let i = 0; i < steps; i++) {
    const bearing = (2 * Math.PI * i) / steps;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearing),
    );
    const lng2 =
      lng1 +
      Math.atan2(
        Math.sin(bearing) * Math.sin(d) * Math.cos(lat1),
        Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
      );
    ring.push([deg(lng2), deg(lat2)]);
  }
  const first = ring[0];
  if (first) ring.push([first[0], first[1]]);
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } };
}
