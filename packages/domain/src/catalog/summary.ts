import { eq, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type { Executor } from '../db/client';
import { destinations } from '../db/schema/catalog';
import { properties, units } from '../db/schema/properties';
import { stays } from '../db/schema/stays';
import type { CivilDate } from '../time';
import type { CatalogScope, LatLng } from './search';

// Helpers the catalog read side (search.ts) and the host place read side (host-picks/guest.ts)
// share; here so neither imports the other's runtime code both ways.

/** The lowest `word_similarity` a record needs to match a guest's words; unrelated prose scores ~0.4. */
export const TEXT_MATCH_MIN = 0.5;

export interface Origin {
  location: { x: number; y: number } | null;
  checkIn: CivilDate;
  checkout: CivilDate;
  zone: string;
}

/** The property's location, the Stay's dates and the destination's zone; null on a broken chain. */
export async function loadOrigin(db: Executor, scope: CatalogScope): Promise<Origin | null> {
  const [row] = await db
    .select({
      location: properties.location,
      propertyId: units.propertyId,
      checkIn: stays.checkIn,
      checkout: stays.checkout,
      zone: destinations.timezone,
    })
    .from(stays)
    .innerJoin(units, eq(units.id, stays.unitId))
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .innerJoin(destinations, eq(destinations.id, scope.destinationId))
    .where(eq(stays.id, scope.stayId));
  if (!row || row.propertyId !== scope.propertyId) return null;
  return { location: row.location, checkIn: row.checkIn, checkout: row.checkout, zone: row.zone };
}

export const todayIn = (now: Date, zone: string): CivilDate =>
  DateTime.fromJSDate(now, { zone }).toISODate() as CivilDate;

/** The day a season check is for: the asked date, else today, but not before check-in. */
export function seasonDate(origin: Origin, now: Date, date?: CivilDate): CivilDate {
  if (date) return date;
  const today = todayIn(now, origin.zone);
  return today > origin.checkIn ? today : origin.checkIn;
}

export const originGeog = (o: Origin) =>
  o.location
    ? sql`ST_SetSRID(ST_MakePoint(${o.location.x}::float8, ${o.location.y}::float8), 4326)::geography`
    : null;

export const latLngOf = (p: { x: number; y: number } | null): LatLng | null =>
  p ? { lat: p.y, lng: p.x } : null;

export const kmOf = (m: unknown): number | null =>
  m === null || m === undefined ? null : Math.round(Number(m) / 100) / 10;

/** The first non-empty paragraph without Markdown markers, at most 280 characters. */
export function summaryOf(markdown: string): string {
  const paragraph =
    markdown
      .split(/\n\s*\n/)
      .map((p) =>
        p
          .replace(/^\s*(?:[#>*-]+\s*)+/gm, '')
          .replace(/\s+/g, ' ')
          .trim(),
      )
      .find(Boolean) ?? '';
  if (paragraph.length <= 280) return paragraph;
  const cut = paragraph.slice(0, 279);
  const space = cut.lastIndexOf(' ');
  return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
