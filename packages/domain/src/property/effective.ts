import type { propertyAmenities, unitAmenities } from '../db/schema/amenities';
import type { infoBlocks } from '../db/schema/info-blocks';
import type { properties, units } from '../db/schema/properties';
import {
  AMENITIES,
  type Amenity,
  BLOCK_CATEGORIES,
  SHARED_CORE_FIELDS,
  type SharedCoreField,
} from './vocabulary';

export type PropertyRow = typeof properties.$inferSelect;
export type UnitRow = typeof units.$inferSelect;
export type BlockRow = typeof infoBlocks.$inferSelect;
type AmenityRow = Pick<typeof propertyAmenities.$inferSelect, 'amenity' | 'note'>;
type UnitAmenityRow = Pick<typeof unitAmenities.$inferSelect, 'amenity' | 'note'>;

export type SharedCore = Pick<PropertyRow, SharedCoreField>;

export type EffectiveBlock = BlockRow & { source: 'property' | 'unit' };

export type EffectiveUnit = SharedCore &
  Pick<
    PropertyRow,
    | 'addressLine'
    | 'city'
    | 'postalCode'
    | 'country'
    | 'location'
    | 'timezone'
    | 'buildingDoorCode'
    | 'approvedAt'
    | 'propertyType'
  > &
  Pick<
    UnitRow,
    | 'propertyId'
    | 'qrSlug'
    | 'noWifi'
    | 'wifiNetwork'
    | 'wifiPassword'
    | 'doorCode'
    | 'lockboxCode'
    | 'maxOccupancy'
    | 'bedrooms'
    | 'beds'
    | 'bathrooms'
    | 'arrivalReleaseDaysBefore'
  > & {
    unitId: string;
    unitName: string;
    propertyName: string;
    /** True where the unit left the field null and the value is the property's. */
    inherited: Record<SharedCoreField, boolean>;
    blocks: EffectiveBlock[];
    amenities: { amenity: Amenity; note: string | null }[];
  };

export interface EffectiveUnitInput {
  property: PropertyRow;
  unit: UnitRow;
  propertyBlocks: BlockRow[];
  unitBlocks: BlockRow[];
  hiddenBlockIds: string[];
  propertyAmenities: AmenityRow[];
  unitAmenities: UnitAmenityRow[];
}

const categoryOrder = (b: BlockRow) => BLOCK_CATEGORIES.indexOf(b.category);

function compareBlocks(a: BlockRow, b: BlockRow): number {
  return (
    categoryOrder(a) - categoryOrder(b) ||
    a.position - b.position ||
    a.createdAt.getTime() - b.createdAt.getTime()
  );
}

/** The unit as a guest sees it: the property's content with the unit's overrides applied. */
export function effectiveUnit(input: EffectiveUnitInput): EffectiveUnit {
  const { property, unit } = input;

  const core = {} as Record<SharedCoreField, unknown>;
  const inherited = {} as Record<SharedCoreField, boolean>;
  for (const field of SHARED_CORE_FIELDS) {
    // `??`, not `||`: a unit's `false` overrides the property's `true`.
    core[field] = unit[field] ?? property[field];
    inherited[field] = unit[field] === null;
  }

  const hidden = new Set(input.hiddenBlockIds);
  const replaced = new Set(input.unitBlocks.map((b) => b.replacesBlockId).filter((id) => id));
  const blocks: EffectiveBlock[] = [
    ...input.propertyBlocks
      .filter((b) => !hidden.has(b.id) && !replaced.has(b.id))
      .map((b) => ({ ...b, source: 'property' as const })),
    ...input.unitBlocks.map((b) => ({ ...b, source: 'unit' as const })),
  ].sort(compareBlocks);

  const notes = new Map<Amenity, string | null>();
  for (const a of input.propertyAmenities) notes.set(a.amenity, a.note);
  for (const a of input.unitAmenities) notes.set(a.amenity, a.note ?? notes.get(a.amenity) ?? null);
  const amenities = AMENITIES.filter((a) => notes.has(a)).map((amenity) => ({
    amenity,
    note: notes.get(amenity) ?? null,
  }));

  return {
    ...(core as SharedCore),
    unitId: unit.id,
    unitName: unit.name,
    propertyId: property.id,
    propertyName: property.name,
    addressLine: property.addressLine,
    city: property.city,
    postalCode: property.postalCode,
    country: property.country,
    location: property.location,
    timezone: property.timezone,
    buildingDoorCode: property.buildingDoorCode,
    approvedAt: property.approvedAt,
    propertyType: property.propertyType,
    qrSlug: unit.qrSlug,
    noWifi: unit.noWifi,
    wifiNetwork: unit.wifiNetwork,
    wifiPassword: unit.wifiPassword,
    doorCode: unit.doorCode,
    lockboxCode: unit.lockboxCode,
    maxOccupancy: unit.maxOccupancy,
    bedrooms: unit.bedrooms,
    beds: unit.beds,
    bathrooms: unit.bathrooms,
    arrivalReleaseDaysBefore: unit.arrivalReleaseDaysBefore,
    inherited,
    blocks,
    amenities,
  };
}
