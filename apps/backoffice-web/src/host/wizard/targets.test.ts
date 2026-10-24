import { SHARED_CORE_FIELDS } from '@fetivi/domain/vocabulary';
import { WIZARD_FIELDS, type WizardFieldId, wizardField } from '@fetivi/domain/wizard';
import { describe, expect, it } from 'vitest';
import type { Block, CoreValues, PropertyDetail, UnitDetail } from '../../api';
import { format } from './copy';
import { fieldPatches, fieldTarget, loadedValues, promptBlock, toggledAmenities } from './targets';

const nullCore = Object.fromEntries(
  SHARED_CORE_FIELDS.map((f) => [f, null]),
) as unknown as CoreValues;

function property(overrides: Partial<PropertyDetail> = {}): PropertyDetail {
  return {
    ...nullCore,
    id: 'p1',
    name: 'Villa Mare',
    propertyType: null,
    addressLine: null,
    city: null,
    postalCode: null,
    country: 'HR',
    location: null,
    timezone: 'Europe/Zagreb',
    buildingDoorCode: null,
    approved: false,
    amenities: [],
    blocks: [],
    units: [],
    fieldTranslations: [],
    ...overrides,
  };
}

function unit(overrides: Partial<UnitDetail> = {}): UnitDetail {
  return {
    ...nullCore,
    id: 'u1',
    propertyId: 'p1',
    propertyName: 'Villa Mare',
    name: 'A1',
    qrSlug: null,
    qrLink: null,
    live: false,
    approved: false,
    timezone: 'Europe/Zagreb',
    noWifi: false,
    wifiNetwork: null,
    wifiPassword: null,
    doorCode: null,
    lockboxCode: null,
    maxOccupancy: null,
    bedrooms: null,
    beds: [],
    bathrooms: null,
    arrivalReleaseDaysBefore: 1,
    propertyValues: nullCore,
    propertyAmenities: [],
    amenities: [],
    blocks: [],
    propertyBlocks: [],
    hiddenBlockIds: [],
    fieldTranslations: [],
    effective: {
      inherited: Object.fromEntries(SHARED_CORE_FIELDS.map((f) => [f, true])) as Record<
        keyof CoreValues,
        boolean
      >,
      blocks: [],
      amenities: [],
    },
    ...overrides,
  };
}

const all = new Set<WizardFieldId>(WIZARD_FIELDS.map((f) => f.id));

describe('fieldTarget', () => {
  it('sends property and unit fields to their owner', () => {
    expect(fieldTarget(wizardField('address'), unit())).toBe('property');
    expect(fieldTarget(wizardField('wifi'), unit())).toBe('unit');
    expect(fieldTarget(wizardField('amenities'), unit())).toBe('property');
  });

  it('sends a core field to the unit only when the unit overrides it', () => {
    expect(fieldTarget(wizardField('check_in_time'), unit())).toBe('property');
    expect(fieldTarget(wizardField('check_in_time'), unit({ checkInTime: '14:00' }))).toBe('unit');
    expect(fieldTarget(wizardField('parking'), unit({ parkingNotes: 'Behind' }))).toBe('unit');
  });
});

describe('fieldPatches', () => {
  it('patches only changed columns of the step, split by target', () => {
    const detail = unit({ checkoutTime: '11:00' });
    const loaded = loadedValues(detail, property({ checkoutTime: '10:00' }));
    expect(loaded.checkoutTime).toBe('11:00');
    const draft = { ...loaded, checkoutTime: '09:30', petsAllowed: false, checkInTime: '15:00' };
    expect(fieldPatches('house_rules_checkout', all, draft, loaded, detail)).toEqual({
      unit: { checkoutTime: '09:30' },
      property: { petsAllowed: false },
    });
  });

  it('sends nothing when nothing changed', () => {
    const detail = unit();
    const loaded = loadedValues(detail, property());
    expect(fieldPatches('arrival_access', all, loaded, loaded, detail)).toEqual({});
  });

  it('skips hidden fields', () => {
    const detail = unit();
    const loaded = loadedValues(detail, property());
    const draft = { ...loaded, buildingDoorCode: '1234' };
    const visible = new Set([...all].filter((id) => id !== 'building_door_code'));
    expect(fieldPatches('arrival_access', visible, draft, loaded, detail)).toEqual({});
  });

  it('sends the location and the beds whole', () => {
    const detail = unit();
    const loaded = loadedValues(detail, property());
    const draft = {
      ...loaded,
      location: { lat: 43.5, lng: 16.2 },
      beds: [{ type: 'double' as const, count: 1 }],
    };
    expect(fieldPatches('arrival_access', all, draft, loaded, detail)).toEqual({
      property: { location: { lat: 43.5, lng: 16.2 } },
    });
    expect(fieldPatches('wifi_essentials', all, draft, loaded, detail)).toEqual({
      unit: { beds: [{ type: 'double', count: 1 }] },
    });
  });
});

describe('promptBlock and amenities', () => {
  it('finds the effective block with the key', () => {
    const block = { id: 'b1', wizardKey: 'laundry', source: 'property' } as Block & {
      source: 'property';
    };
    const detail = unit({ effective: { ...unit().effective, blocks: [block] } });
    expect(promptBlock('laundry', detail)?.id).toBe('b1');
    expect(promptBlock('hot_water', detail)).toBeNull();
  });

  it('toggles an amenity and keeps the notes of the others', () => {
    const current = [{ amenity: 'pool' as const, note: 'May to October' }];
    expect(toggledAmenities(current, 'ac', true)).toEqual([
      ...current,
      { amenity: 'ac', note: null },
    ]);
    expect(toggledAmenities(current, 'pool', false)).toEqual([]);
  });
});

describe('format', () => {
  it('fills placeholders and leaves unknown ones', () => {
    expect(format('Step {n} of {total}', { n: 2, total: 7 })).toBe('Step 2 of 7');
    expect(format('{x} left', {})).toBe('{x} left');
  });
});
