import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  index,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { parseEWKB } from 'drizzle-orm/pg-core/columns/postgis_extension/utils';
import { type Bed, CHECK_IN_METHODS, PARKING_TYPES } from '../../property/vocabulary';
import { accounts } from './accounts';

export const checkInMethod = pgEnum('check_in_method', CHECK_IN_METHODS);
export const parkingType = pgEnum('parking_type', PARKING_TYPES);

/**
 * A WGS 84 point, x = longitude, y = latitude. Drizzle's own `geometry()` drops the SRID from
 * both the column type and the values it writes, so the column would accept any SRID.
 */
export const wgs84Point = customType<{ data: { x: number; y: number }; driverData: string }>({
  dataType: () => 'geometry(point, 4326)',
  toDriver: ({ x, y }) => `SRID=4326;POINT(${x} ${y})`,
  fromDriver: (value) => {
    const [x, y] = parseEWKB(value);
    return { x, y };
  },
});

/** Core fields a property sets and a unit may override. Null on a unit means "inherit". */
export const sharedCoreColumns = () => ({
  /** Earliest check-in. */
  checkInTime: time('check_in_time'),
  /** Latest checkout. */
  checkoutTime: time('checkout_time'),
  checkInMethod: checkInMethod('check_in_method'),
  accessInstructions: text('access_instructions'),
  parkingType: parkingType('parking_type'),
  parkingNotes: text('parking_notes'),
  petsAllowed: boolean('pets_allowed'),
  smokingAllowed: boolean('smoking_allowed'),
  partiesAllowed: boolean('parties_allowed'),
  quietHoursFrom: time('quiet_hours_from'),
  quietHoursTo: time('quiet_hours_to'),
  houseRulesNotes: text('house_rules_notes'),
  /** Secret: a typed field, never in block text. */
  hostPhone: text('host_phone'),
  emergencyContactName: text('emergency_contact_name'),
  /** Secret. */
  emergencyContactPhone: text('emergency_contact_phone'),
  licenceNumber: text('licence_number'),
});

export const properties = pgTable(
  'properties',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    hostId: uuid('host_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    addressLine: text('address_line'),
    city: text('city'),
    postalCode: text('postal_code'),
    /** ISO 3166-1 alpha-2. */
    country: text('country').notNull().default('HR'),
    location: wgs84Point('location'),
    /** IANA zone; stay dates and the arrival release are civil times in it. */
    timezone: text('timezone').notNull().default('Europe/Zagreb'),
    /** Secret. */
    buildingDoorCode: text('building_door_code'),
    ...sharedCoreColumns(),
    /** Set once by an admin; units get their QR slugs from then on. */
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvedBy: uuid('approved_by').references(() => accounts.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('properties_host_idx').on(t.hostId),
    index('properties_location_gist').using('gist', t.location),
  ],
);

export const units = pgTable(
  'units',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** The permanent guest link; issued when the property is approved, never changed. */
    qrSlug: text('qr_slug').unique(),
    ...sharedCoreColumns(),
    noWifi: boolean('no_wifi').notNull().default(false),
    wifiNetwork: text('wifi_network'),
    /** Secret. */
    wifiPassword: text('wifi_password'),
    /** Secret. */
    doorCode: text('door_code'),
    /** Secret. */
    lockboxCode: text('lockbox_code'),
    maxOccupancy: smallint('max_occupancy'),
    bedrooms: smallint('bedrooms'),
    beds: jsonb('beds').$type<Bed[]>().notNull().default([]),
    bathrooms: smallint('bathrooms'),
    /** Arrival details appear at 00:00 this many days before check-in, in property time. */
    arrivalReleaseDaysBefore: smallint('arrival_release_days_before').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('units_property_idx').on(t.propertyId),
    check('units_release_days_check', sql`${t.arrivalReleaseDaysBefore} between 0 and 7`),
    check(
      'units_counts_check',
      sql`(${t.maxOccupancy} is null or ${t.maxOccupancy} between 1 and 50) and (${t.bedrooms} is null or ${t.bedrooms} between 0 and 50) and (${t.bathrooms} is null or ${t.bathrooms} between 0 and 50)`,
    ),
  ],
);
