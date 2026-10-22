import { eq, gt, inArray } from 'drizzle-orm';
import type { Executor } from '../db/client';
import { catalogRecords } from '../db/schema/catalog';
import { offers } from '../db/schema/offers';
import { properties, units } from '../db/schema/properties';
import { spaces } from '../db/schema/spaces';
import { stays } from '../db/schema/stays';
import { getPlan, type PlanItem, PlanRuleError } from '../plan/store';
import type { GuestLanguage } from '../property/vocabulary';
import type { CivilDate } from '../time';
import type { GeoPoint } from '../weather/areas';
import type { AffectedItem } from './vocabulary';

// What the safety-alerts job knows about each open Space: where and when the Stay is, and the plan
// items and booked Orders that depend on a ferry or catamaran line. A plan item reaches its lines
// through its catalog place or its Offer's place; an Order through its Offer's place.

export interface AlertSpace {
  spaceId: string;
  language: GuestLanguage;
  /** The property's IANA zone. */
  zone: string;
  /** The property's location; null when it has none. */
  place: GeoPoint | null;
  checkIn: CivilDate;
  closedAt: Date;
  /** Items that depend on a line, by date then time, Orders first on a tie. */
  items: AffectedItem[];
}

/**
 * Every open Space with its line-dependent items. A possibly cancelled Stay is included: safety
 * is always sent while the Space is open.
 */
export async function listAlertSpaces(db: Executor, now: Date): Promise<AlertSpace[]> {
  const rows = await db
    .select({
      spaceId: spaces.id,
      language: spaces.language,
      closedAt: spaces.closedAt,
      checkIn: stays.checkIn,
      zone: properties.timezone,
      location: properties.location,
    })
    .from(spaces)
    .innerJoin(stays, eq(stays.id, spaces.stayId))
    .innerJoin(units, eq(units.id, stays.unitId))
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .where(gt(spaces.closedAt, now));

  const plans = new Map<string, PlanItem[]>();
  for (const row of rows) {
    try {
      const plan = await getPlan(db, { spaceId: row.spaceId, language: row.language }, now);
      plans.set(
        row.spaceId,
        plan.days.flatMap((day) => day.items),
      );
    } catch (error) {
      // A Space gone between the two reads is skipped, not a failed run.
      if (error instanceof PlanRuleError && error.code === 'not-found') continue;
      throw error;
    }
  }

  const items = [...plans.values()].flat();
  const linesByPlace = await placeLines(
    db,
    items.flatMap((item) => (item.placeId ? [item.placeId] : [])),
  );
  const linesByOffer = await offerLines(
    db,
    items.flatMap((item) => (item.offerId ? [item.offerId] : [])),
  );

  return rows.flatMap((row) => {
    const plan = plans.get(row.spaceId);
    if (!plan) return [];
    const affected = plan.flatMap((item): AffectedItem[] => {
      const lines = [
        ...new Set([
          ...(item.placeId ? (linesByPlace.get(item.placeId) ?? []) : []),
          ...(item.offerId ? (linesByOffer.get(item.offerId) ?? []) : []),
        ]),
      ];
      if (lines.length === 0) return [];
      return [
        {
          title: item.title,
          date: item.date,
          startTime: item.time,
          orderId: item.orderId,
          lines,
        },
      ];
    });
    return [
      {
        spaceId: row.spaceId,
        language: row.language,
        zone: row.zone,
        // wgs84Point is { x: lng, y: lat }.
        place: row.location ? { lat: row.location.y, lng: row.location.x } : null,
        checkIn: row.checkIn,
        closedAt: row.closedAt,
        items: affected,
      },
    ];
  });
}

async function placeLines(db: Executor, ids: string[]): Promise<Map<string, string[]>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: catalogRecords.id, lines: catalogRecords.ferryLines })
    .from(catalogRecords)
    .where(inArray(catalogRecords.id, [...new Set(ids)]));
  return new Map(rows.map((r) => [r.id, r.lines]));
}

async function offerLines(db: Executor, ids: string[]): Promise<Map<string, string[]>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: offers.id, lines: catalogRecords.ferryLines })
    .from(offers)
    .innerJoin(catalogRecords, eq(catalogRecords.id, offers.placeId))
    .where(inArray(offers.id, [...new Set(ids)]));
  return new Map(rows.map((r) => [r.id, r.lines]));
}
