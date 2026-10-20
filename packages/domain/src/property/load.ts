import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { propertyAmenities, unitAmenities } from '../db/schema/amenities';
import { infoBlocks, unitHiddenBlocks } from '../db/schema/info-blocks';
import { properties, units } from '../db/schema/properties';
import { type EffectiveUnit, effectiveUnit } from './effective';

/** Loads a unit with everything it inherits and merges it; null when the unit does not exist. */
export async function loadEffectiveUnit(db: Db, unitId: string): Promise<EffectiveUnit | null> {
  const [unit] = await db.select().from(units).where(eq(units.id, unitId));
  if (!unit) return null;
  const [property] = await db.select().from(properties).where(eq(properties.id, unit.propertyId));
  if (!property) return null;

  const [propertyBlocks, unitBlocks, hidden, pAmenities, uAmenities] = await Promise.all([
    db
      .select()
      .from(infoBlocks)
      .where(eq(infoBlocks.propertyId, property.id))
      .orderBy(asc(infoBlocks.position)),
    db
      .select()
      .from(infoBlocks)
      .where(eq(infoBlocks.unitId, unit.id))
      .orderBy(asc(infoBlocks.position)),
    db
      .select({ blockId: unitHiddenBlocks.blockId })
      .from(unitHiddenBlocks)
      .where(eq(unitHiddenBlocks.unitId, unit.id)),
    db
      .select({ amenity: propertyAmenities.amenity, note: propertyAmenities.note })
      .from(propertyAmenities)
      .where(eq(propertyAmenities.propertyId, property.id)),
    db
      .select({ amenity: unitAmenities.amenity, note: unitAmenities.note })
      .from(unitAmenities)
      .where(eq(unitAmenities.unitId, unit.id)),
  ]);

  return effectiveUnit({
    property,
    unit,
    propertyBlocks,
    unitBlocks,
    hiddenBlockIds: hidden.map((h) => h.blockId),
    propertyAmenities: pAmenities,
    unitAmenities: uAmenities,
  });
}
