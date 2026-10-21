import {
  emptyExtraction,
  type ManualDraftItem,
  type ManualExtractionData,
  sampleExtraction,
  type WizardValues,
} from '@fetivi/domain';
import { describe, expect, it } from 'vitest';
import { buildDrafts } from './drafts';

function emptyValues(): WizardValues {
  return {
    addressLine: null,
    city: null,
    postalCode: null,
    location: false,
    buildingDoorCode: null,
    checkInTime: null,
    checkoutTime: null,
    checkInMethod: null,
    accessInstructions: null,
    parkingType: null,
    parkingNotes: null,
    petsAllowed: null,
    smokingAllowed: null,
    partiesAllowed: null,
    quietHoursFrom: null,
    quietHoursTo: null,
    houseRulesNotes: null,
    hostPhone: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    licenceNumber: null,
    noWifi: false,
    wifiNetwork: null,
    wifiPassword: null,
    doorCode: null,
    lockboxCode: null,
    maxOccupancy: null,
    bedrooms: null,
    bathrooms: null,
    beds: [],
    arrivalReleaseDaysBefore: 1,
  };
}

const empty = { values: emptyValues(), amenities: [] };

function withFields(fields: Partial<ManualExtractionData['fields']>): ManualExtractionData {
  const e = emptyExtraction();
  return { ...e, fields: { ...e.fields, ...fields } };
}

const block = (over: Partial<ManualExtractionData['blocks'][number]> = {}) => ({
  category: 'how_tos' as const,
  wizardKey: null,
  title: 'Air conditioning',
  body: 'Press ON/OFF.',
  ...over,
});

const ofKind = <K extends ManualDraftItem['kind']>(items: ManualDraftItem[], kind: K) =>
  items.filter((i): i is Extract<ManualDraftItem, { kind: K }> => i.kind === kind);

describe('buildDrafts', () => {
  it('drafts a valid time and moves an invalid one to unmapped with its field', () => {
    expect(buildDrafts(withFields({ checkInTime: '15:00' }), empty)).toEqual([
      {
        id: 'd1',
        status: 'pending',
        kind: 'field',
        fieldId: 'check_in_time',
        values: { checkInTime: '15:00' },
      },
    ]);
    expect(buildDrafts(withFields({ checkInTime: 'around 3pm' }), empty)).toEqual([
      {
        id: 'd1',
        status: 'pending',
        kind: 'unmapped',
        text: 'around 3pm',
        fieldId: 'check_in_time',
      },
    ]);
  });

  it('leaves out a value equal to the saved one, comparing times on HH:MM', () => {
    const current = { values: { ...emptyValues(), checkInTime: '15:00:00' }, amenities: [] };
    expect(buildDrafts(withFields({ checkInTime: '15:00' }), current)).toEqual([]);
  });

  it('keeps only the changed columns of a multi-column field', () => {
    const current = { values: { ...emptyValues(), addressLine: 'Obala 1' }, amenities: [] };
    const [item] = buildDrafts(withFields({ addressLine: 'Obala 1', city: 'Trogir' }), current);
    expect(item).toMatchObject({ kind: 'field', fieldId: 'address', values: { city: 'Trogir' } });
  });

  it('drafts Wi-Fi with noWifi false, or noWifi true alone', () => {
    const current = { values: { ...emptyValues(), noWifi: true }, amenities: [] };
    const [given] = buildDrafts(
      withFields({ wifiNetwork: 'MareGuest', wifiPassword: 'sunce2024' }),
      current,
    );
    expect(given).toMatchObject({
      fieldId: 'wifi',
      values: { noWifi: false, wifiNetwork: 'MareGuest', wifiPassword: 'sunce2024' },
    });
    const [none] = buildDrafts(withFields({ noWifi: true, wifiNetwork: 'ignored' }), empty);
    expect(none).toMatchObject({ fieldId: 'wifi', values: { noWifi: true } });
    expect(none?.kind === 'field' && Object.keys(none.values)).toEqual(['noWifi']);
  });

  it('drops amenities already present and proposes none when nothing is new', () => {
    const e = emptyExtraction();
    const extraction = {
      ...e,
      amenities: [
        { amenity: 'ac' as const, note: null },
        { amenity: 'tv' as const, note: 'Smart TV' },
      ],
    };
    expect(buildDrafts(extraction, { ...empty, amenities: ['ac'] })).toEqual([
      {
        id: 'd1',
        status: 'pending',
        kind: 'amenities',
        amenities: [{ amenity: 'tv', note: 'Smart TV' }],
      },
    ]);
    expect(buildDrafts(extraction, { ...empty, amenities: ['ac', 'tv'] })).toEqual([]);
  });

  it('scrubs an extracted secret from block text and computes warnings', () => {
    const extraction = {
      ...withFields({ wifiPassword: 'sunce2024' }),
      blocks: [block({ body: 'The password is sunce2024. Call +385 91 234 5678.' })],
    };
    const [blockItem] = ofKind(buildDrafts(extraction, empty), 'block');
    expect(blockItem?.body).toBe('The password is ***. Call +385 91 234 5678.');
    expect(blockItem?.scrubbed).toBe(true);
    expect(blockItem?.warnings.map((w) => w.kind)).toContain('phone');
  });

  it('keeps the first block of a wizard key and caps the number of blocks', () => {
    const e = emptyExtraction();
    const keyed = buildDrafts(
      {
        ...e,
        blocks: [
          block({ wizardKey: 'heating_cooling' }),
          block({ wizardKey: 'heating_cooling', title: 'Heating' }),
        ],
      },
      empty,
    );
    expect(ofKind(keyed, 'block').map((b) => b.wizardKey)).toEqual(['heating_cooling', null]);

    const many = buildDrafts(
      { ...e, blocks: Array.from({ length: 42 }, (_, i) => block({ title: `Tip ${i}` })) },
      empty,
    );
    expect(ofKind(many, 'block')).toHaveLength(40);
    expect(ofKind(many, 'unmapped').map((u) => u.text)).toEqual([
      'Tip 40\n\nPress ON/OFF.',
      'Tip 41\n\nPress ON/OFF.',
    ]);
  });

  it('moves a block with an empty title or body to unmapped', () => {
    const e = emptyExtraction();
    const items = buildDrafts(
      { ...e, blocks: [block({ title: '  ' }), block({ body: '<b></b>' })] },
      empty,
    );
    expect(items.map((i) => i.kind)).toEqual(['unmapped', 'unmapped']);
    expect(ofKind(items, 'unmapped').map((u) => u.text)).toEqual([
      'Press ON/OFF.',
      'Air conditioning',
    ]);
  });

  it('numbers the drafts in order, all pending', () => {
    const items = buildDrafts(sampleExtraction(), empty);
    expect(items.map((i) => i.id)).toEqual(items.map((_, i) => `d${i + 1}`));
    expect(new Set(items.map((i) => i.status))).toEqual(new Set(['pending']));
    expect(items.map((i) => i.kind)).toEqual([
      ...Array(items.filter((i) => i.kind === 'field').length).fill('field'),
      'amenities',
      'block',
      'block',
      'block',
      'block',
      'unmapped',
    ]);
  });

  it('strips markup from unmapped text and removes duplicates', () => {
    const e = emptyExtraction();
    const items = buildDrafts(
      { ...e, unmapped: ['Cat <script>alert(1)</script>visits', 'Cat visits', '  '] },
      empty,
    );
    expect(ofKind(items, 'unmapped').map((u) => u.text)).toEqual(['Cat visits']);
  });
});
