import { pgEnum, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { AMENITIES } from '../../property/vocabulary';
import { properties, units } from './properties';

export const amenity = pgEnum('amenity', AMENITIES);

export const propertyAmenities = pgTable(
  'property_amenities',
  {
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    amenity: amenity('amenity').notNull(),
    note: text('note'),
  },
  (t) => [primaryKey({ columns: [t.propertyId, t.amenity] })],
);

/** Adds to the property's amenities; a unit cannot remove one. */
export const unitAmenities = pgTable(
  'unit_amenities',
  {
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' }),
    amenity: amenity('amenity').notNull(),
    note: text('note'),
  },
  (t) => [primaryKey({ columns: [t.unitId, t.amenity] })],
);
