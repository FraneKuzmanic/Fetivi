import { sql } from 'drizzle-orm';
import type { Executor } from '../db/client';
import { type DestinationRow, destinations } from '../db/schema/catalog';

/** The destination whose area contains the point (nearest centre if several), or null. */
export async function findDestinationAt(
  db: Executor,
  point: { lat: number; lng: number },
): Promise<DestinationRow | null> {
  const p = sql`ST_SetSRID(ST_MakePoint(${point.lng}::float8, ${point.lat}::float8), 4326)::geography`;
  const [row] = await db
    .select()
    .from(destinations)
    .where(sql`ST_DWithin(${destinations.centre}::geography, ${p}, ${destinations.radiusM})`)
    .orderBy(sql`ST_Distance(${destinations.centre}::geography, ${p})`)
    .limit(1);
  return row ?? null;
}
