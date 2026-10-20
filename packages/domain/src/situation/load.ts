import { and, eq } from 'drizzle-orm';
import { findDestinationAt } from '../catalog/destination';
import type { Executor } from '../db/client';
import { offers } from '../db/schema/offers';
import { properties, units } from '../db/schema/properties';
import { spaces } from '../db/schema/spaces';
import { stays } from '../db/schema/stays';
import type { GuestLanguage } from '../property/vocabulary';
import { type Situation, situationOf } from './situation';

export interface SpaceContext extends Situation {
  spaceId: string;
  stayId: string;
  unitId: string;
  propertyId: string;
  destinationId: string | null;
  language: GuestLanguage;
  closed: boolean;
}

/** The ids and situation behind a space at `now`; null when the space (or its Stay) is gone. */
export async function loadSituation(
  db: Executor,
  spaceId: string,
  now: Date,
): Promise<SpaceContext | null> {
  const [row] = await db
    .select({
      stayId: stays.id,
      unitId: units.id,
      propertyId: properties.id,
      checkIn: stays.checkIn,
      activeUntil: stays.activeUntil,
      timezone: properties.timezone,
      location: properties.location,
      hostId: properties.hostId,
      language: spaces.language,
      closedAt: spaces.closedAt,
    })
    .from(spaces)
    .innerJoin(stays, eq(stays.id, spaces.stayId))
    .innerJoin(units, eq(units.id, stays.unitId))
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .where(eq(spaces.id, spaceId));
  if (!row) return null;

  // wgs84Point is { x: lng, y: lat }; a property without a location is outside every destination.
  const destination = row.location
    ? await findDestinationAt(db, { lat: row.location.y, lng: row.location.x })
    : null;
  // Own Offers are host-level (offers.host_id), not property-level.
  const [own] = await db
    .select({ id: offers.id })
    .from(offers)
    .where(and(eq(offers.hostId, row.hostId), eq(offers.active, true)))
    .limit(1);

  const destinationId = destination?.id ?? null;
  return {
    ...situationOf(
      {
        stay: { checkIn: row.checkIn, activeUntil: row.activeUntil },
        timezone: row.timezone,
        destinationId,
        hostHasOwnOffers: own !== undefined,
      },
      now,
    ),
    spaceId,
    stayId: row.stayId,
    unitId: row.unitId,
    propertyId: row.propertyId,
    destinationId,
    language: row.language,
    closed: now >= row.closedAt,
  };
}
