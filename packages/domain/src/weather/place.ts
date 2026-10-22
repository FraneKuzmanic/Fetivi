import { eq } from 'drizzle-orm';
import type { Executor } from '../db/client';
import { properties } from '../db/schema/properties';
import type { WeatherPlace } from './source';

/** Where the weather is asked for: the property's point and zone. Null without a row or a location. */
export async function weatherPlaceOf(
  db: Executor,
  propertyId: string,
): Promise<WeatherPlace | null> {
  const [row] = await db
    .select({ location: properties.location, timezone: properties.timezone })
    .from(properties)
    .where(eq(properties.id, propertyId))
    .limit(1);
  // wgs84Point is { x: lng, y: lat }.
  if (!row?.location) return null;
  return { lat: row.location.y, lng: row.location.x, timezone: row.timezone };
}
