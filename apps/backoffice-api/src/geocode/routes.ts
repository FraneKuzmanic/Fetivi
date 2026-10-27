import { GEOCODE_KINDS, GEOCODE_LIMITS, type Geocoder, GeocoderError } from '@fetivi/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError } from '../http-error';

export interface GeocodeDeps {
  /** Null turns address search off: the routes answer 503 and the form keeps manual entry. */
  geocoder: Geocoder | null;
}

const SearchQuery = z.object({
  q: z.string().trim().min(GEOCODE_LIMITS.queryMin).max(GEOCODE_LIMITS.queryMax),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  kind: z.enum(GEOCODE_KINDS).default('address'),
});

const ReverseQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

/**
 * Address search for the host's property form, proxied so the provider sees Fetivi, not the
 * host's browser. Only hosts may call it: it costs the shared public geocoder.
 */
export async function geocodeRoutes(app: FastifyInstance, deps: GeocodeDeps) {
  const host = { config: { access: 'host' as const } };
  const geocoderOf = () => {
    if (!deps.geocoder) throw new HttpError(503, 'geocoder-unavailable');
    return deps.geocoder;
  };
  const unavailable = async <T>(run: () => Promise<T>) => {
    try {
      return await run();
    } catch (error) {
      if (error instanceof GeocoderError) throw new HttpError(502, 'geocoder-unavailable');
      throw error;
    }
  };

  app.get('/api/host/geocode', host, async (request) => {
    const { q, lat, lng, kind } = SearchQuery.parse(request.query);
    const near = lat !== undefined && lng !== undefined ? { lat, lng } : undefined;
    const geocoder = geocoderOf();
    return { places: await unavailable(() => geocoder.search(q, { near, kind })) };
  });

  app.get('/api/host/geocode/reverse', host, async (request) => {
    const { lat, lng } = ReverseQuery.parse(request.query);
    const geocoder = geocoderOf();
    return { place: await unavailable(() => geocoder.reverse(lat, lng)) };
  });
}
