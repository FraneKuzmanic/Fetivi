import { describe, expect, it } from 'vitest';
import {
  type BlockRow,
  type EffectiveUnitInput,
  effectiveUnit,
  type PropertyRow,
  type UnitRow,
} from './effective';
import { SHARED_CORE_FIELDS } from './vocabulary';

const at = new Date('2026-10-01T10:00:00Z');
const nullCore = Object.fromEntries(SHARED_CORE_FIELDS.map((f) => [f, null]));

function property(overrides: Partial<PropertyRow> = {}): PropertyRow {
  return {
    ...(nullCore as Pick<PropertyRow, (typeof SHARED_CORE_FIELDS)[number]>),
    id: 'p1',
    hostId: 'h1',
    name: 'Villa Mare',
    propertyType: null,
    addressLine: 'Obala 1',
    city: 'Trogir',
    postalCode: '21220',
    country: 'HR',
    location: { x: 16.25, y: 43.52 },
    timezone: 'Europe/Zagreb',
    buildingDoorCode: null,
    approvedAt: null,
    approvedBy: null,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

function unit(overrides: Partial<UnitRow> = {}): UnitRow {
  return {
    ...(nullCore as Pick<UnitRow, (typeof SHARED_CORE_FIELDS)[number]>),
    id: 'u1',
    propertyId: 'p1',
    name: 'Apartment 1',
    qrSlug: null,
    noWifi: false,
    wifiNetwork: 'Mare',
    wifiPassword: 'secret',
    doorCode: null,
    lockboxCode: null,
    maxOccupancy: 4,
    bedrooms: 2,
    beds: [{ type: 'double', count: 1 }],
    bathrooms: 1,
    arrivalReleaseDaysBefore: 1,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

let seq = 0;
function block(overrides: Partial<BlockRow>): BlockRow {
  seq += 1;
  return {
    id: `b${seq}`,
    propertyId: null,
    unitId: null,
    category: 'how_tos',
    title: `Block ${seq}`,
    body: 'Body',
    visibility: 'always',
    revision: 1,
    publishedRevision: null,
    translationStatus: 'pending',
    translationError: null,
    sourceLanguage: null,
    replacesBlockId: null,
    wizardKey: null,
    position: 0,
    createdAt: new Date(at.getTime() + seq * 1000),
    updatedAt: at,
    ...overrides,
  };
}

function input(overrides: Partial<EffectiveUnitInput> = {}): EffectiveUnitInput {
  return {
    property: property(),
    unit: unit(),
    propertyBlocks: [],
    unitBlocks: [],
    hiddenBlockIds: [],
    propertyAmenities: [],
    unitAmenities: [],
    ...overrides,
  };
}

describe('effectiveUnit core fields', () => {
  it('passes the property type through', () => {
    expect(
      effectiveUnit(input({ property: property({ propertyType: 'villa' }) })).propertyType,
    ).toBe('villa');
  });

  it('inherits a field the unit leaves null', () => {
    const e = effectiveUnit(input({ property: property({ checkInTime: '15:00:00' }) }));
    expect(e.checkInTime).toBe('15:00:00');
    expect(e.inherited.checkInTime).toBe(true);
  });

  it("uses the unit's value where it sets one", () => {
    const e = effectiveUnit(
      input({
        property: property({ checkInTime: '15:00:00' }),
        unit: unit({ checkInTime: '16:00:00' }),
      }),
    );
    expect(e.checkInTime).toBe('16:00:00');
    expect(e.inherited.checkInTime).toBe(false);
  });

  it("lets a unit's false override the property's true", () => {
    const e = effectiveUnit(
      input({ property: property({ petsAllowed: true }), unit: unit({ petsAllowed: false }) }),
    );
    expect(e.petsAllowed).toBe(false);
    expect(e.inherited.petsAllowed).toBe(false);
  });

  it('passes property-only and unit-only fields through', () => {
    const e = effectiveUnit(input());
    expect(e).toMatchObject({
      timezone: 'Europe/Zagreb',
      location: { x: 16.25, y: 43.52 },
      wifiPassword: 'secret',
      maxOccupancy: 4,
      unitName: 'Apartment 1',
      propertyName: 'Villa Mare',
    });
  });
});

describe('effectiveUnit blocks', () => {
  it('drops hidden and replaced property blocks and adds unit blocks, in Guide order', () => {
    const keep = block({ propertyId: 'p1', category: 'how_tos', position: 1 });
    const hidden = block({ propertyId: 'p1', category: 'how_tos' });
    const replaced = block({ propertyId: 'p1', category: 'arrival_access' });
    const replacement = block({
      unitId: 'u1',
      category: 'arrival_access',
      replacesBlockId: replaced.id,
    });
    const own = block({ unitId: 'u1', category: 'how_tos', position: 0 });
    const contacts = block({ unitId: 'u1', category: 'contacts_emergency' });

    const e = effectiveUnit(
      input({
        propertyBlocks: [keep, hidden, replaced],
        unitBlocks: [contacts, own, replacement],
        hiddenBlockIds: [hidden.id],
      }),
    );
    expect(e.blocks.map((b) => [b.id, b.source])).toEqual([
      [replacement.id, 'unit'],
      [own.id, 'unit'],
      [keep.id, 'property'],
      [contacts.id, 'unit'],
    ]);
  });

  it('orders blocks of one category and position by creation', () => {
    const first = block({ propertyId: 'p1' });
    const second = block({ propertyId: 'p1' });
    const e = effectiveUnit(input({ propertyBlocks: [second, first] }));
    expect(e.blocks.map((b) => b.id)).toEqual([first.id, second.id]);
  });
});

describe('effectiveUnit amenities', () => {
  it('unions property and unit amenities, unit note first, falling back to the property note', () => {
    const e = effectiveUnit(
      input({
        propertyAmenities: [
          { amenity: 'pool', note: 'Heated May to October' },
          { amenity: 'elevator', note: null },
          { amenity: 'wifi', note: 'Fibre' },
        ],
        unitAmenities: [
          { amenity: 'wifi', note: 'Own router' },
          { amenity: 'pool', note: null },
          { amenity: 'balcony', note: 'Sea view' },
        ],
      }),
    );
    expect(e.amenities).toEqual([
      { amenity: 'balcony', note: 'Sea view' },
      { amenity: 'elevator', note: null },
      { amenity: 'pool', note: 'Heated May to October' },
      { amenity: 'wifi', note: 'Own router' },
    ]);
  });
});
