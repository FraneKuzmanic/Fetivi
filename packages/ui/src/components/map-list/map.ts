import type { PlaceCardPayload } from '../../payloads';

/** OpenFreeMap: OSM data, no key; its attribution comes with the style and must stay visible. */
export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

/**
 * MapLibre and its stylesheet, loaded only when a map is shown, so server rendering and tests never
 * touch WebGL code and the first paint does not wait for it. The worker is passed as its own URL:
 * MapLibre looks for it next to its module, which the bundler moves (dev pre-bundling, build).
 */
export async function loadMapLibre() {
  const [maplibre, worker] = await Promise.all([
    import('maplibre-gl'),
    import('maplibre-gl/dist/maplibre-gl-worker.mjs?url'),
    import('maplibre-gl/dist/maplibre-gl.css'),
  ]);
  maplibre.setWorkerUrl(worker.default);
  return maplibre;
}

/** [[west, south], [east, north]] around the places with a location; null when none has one. */
export function boundsOf(
  places: readonly Pick<PlaceCardPayload, 'location'>[],
): [[number, number], [number, number]] | null {
  const points = places.flatMap((p) => (p.location ? [p.location] : []));
  if (points.length === 0) return null;
  const lngs = points.map((p) => p.lng);
  const lats = points.map((p) => p.lat);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}
