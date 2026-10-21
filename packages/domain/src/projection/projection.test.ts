import { describe, expect, it } from 'vitest';
import type { BlockTranslationRow } from '../db/schema/translations';
import {
  type BlockRow,
  effectiveUnit,
  type PropertyRow,
  type UnitRow,
} from '../property/effective';
import { GUEST_LANGUAGES, type GuestLanguage, SHARED_CORE_FIELDS } from '../property/vocabulary';
import { guestProjection, type ProjectionInput } from './projection';

const at = new Date('2026-10-01T10:00:00Z');
const RELEASE = new Date('2026-10-20T22:00:00Z');
const nullCore = Object.fromEntries(SHARED_CORE_FIELDS.map((f) => [f, null]));

const SECRETS = {
  buildingDoorCode: 'BLD-7781',
  doorCode: 'DOOR-4412',
  lockboxCode: 'LBX-9020',
  wifiPassword: 'WIFI-pass-5531',
  hostPhone: '+385-91-000-1111',
  emergencyContactPhone: '+385-91-000-2222',
};
const ACCESS = 'Blue gate on the left, second floor';
const PRIVATE = {
  propertyId: 'a1a1a1a1-0000-4000-8000-000000000001',
  unitId: 'a1a1a1a1-0000-4000-8000-000000000002',
  hostId: 'a1a1a1a1-0000-4000-8000-000000000003',
  qrSlug: 'qrslug-zz91',
  licenceNumber: 'LIC-HR-0042',
  bookerName: 'Booker Bartholomew',
  reservationNumber: 'RES-55667788',
  pin: '864213',
};
const BLOCK_ALWAYS = 'b0b0b0b0-0000-4000-8000-000000000001';
const BLOCK_AFTER = 'b0b0b0b0-0000-4000-8000-000000000002';
const BLOCK_NEVER = 'b0b0b0b0-0000-4000-8000-000000000003';
const BLOCK_REVISED = 'b0b0b0b0-0000-4000-8000-000000000004';

const property: PropertyRow = {
  ...(nullCore as Pick<PropertyRow, (typeof SHARED_CORE_FIELDS)[number]>),
  id: PRIVATE.propertyId,
  hostId: PRIVATE.hostId,
  name: 'Villa Mare',
  addressLine: 'Obala 1',
  city: 'Trogir',
  postalCode: '21220',
  country: 'HR',
  location: { x: 16.25, y: 43.52 },
  timezone: 'Europe/Zagreb',
  buildingDoorCode: SECRETS.buildingDoorCode,
  hostPhone: SECRETS.hostPhone,
  emergencyContactName: 'Ana',
  emergencyContactPhone: SECRETS.emergencyContactPhone,
  licenceNumber: PRIVATE.licenceNumber,
  checkInTime: '15:00:00',
  approvedAt: at,
  approvedBy: null,
  createdAt: at,
  updatedAt: at,
};

function unitRow(overrides: Partial<UnitRow> = {}): UnitRow {
  return {
    ...(nullCore as Pick<UnitRow, (typeof SHARED_CORE_FIELDS)[number]>),
    id: PRIVATE.unitId,
    propertyId: PRIVATE.propertyId,
    name: 'Apartment 1',
    qrSlug: PRIVATE.qrSlug,
    accessInstructions: ACCESS,
    noWifi: false,
    wifiNetwork: 'Mare',
    wifiPassword: SECRETS.wifiPassword,
    doorCode: SECRETS.doorCode,
    lockboxCode: SECRETS.lockboxCode,
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

function block(id: string, overrides: Partial<BlockRow>): BlockRow {
  return {
    id,
    propertyId: null,
    unitId: PRIVATE.unitId,
    category: 'how_tos',
    title: `source title ${id}`,
    body: `source body ${id}`,
    visibility: 'always',
    revision: 1,
    publishedRevision: 1,
    translationStatus: 'published',
    translationError: null,
    sourceLanguage: 'en',
    replacesBlockId: null,
    position: 0,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

const blocks = [
  block(BLOCK_ALWAYS, { category: 'wifi_essentials' }),
  block(BLOCK_AFTER, { category: 'arrival_access', visibility: 'after_release' }),
  block(BLOCK_NEVER, { publishedRevision: null, translationStatus: 'pending' }),
  block(BLOCK_REVISED, { revision: 2, publishedRevision: 1, translationStatus: 'pending' }),
];

const title = (id: string, revision: number, l: GuestLanguage) =>
  `[${l}] r${revision} T block-${id.slice(-1)}`;
const body = (id: string, revision: number, l: GuestLanguage) =>
  `[${l}] r${revision} B block-${id.slice(-1)}`;
type TranslationInput = Pick<
  BlockTranslationRow,
  'blockId' | 'revision' | 'language' | 'title' | 'body' | 'captions'
>;
const translations: TranslationInput[] = [
  ...[BLOCK_ALWAYS, BLOCK_AFTER, BLOCK_NEVER].map((id) => ({ id, revision: 1 })),
  { id: BLOCK_REVISED, revision: 1 },
  { id: BLOCK_REVISED, revision: 2 },
].flatMap(({ id, revision }) =>
  GUEST_LANGUAGES.map((language) => ({
    blockId: id,
    revision,
    language,
    title: title(id, revision, language),
    body: body(id, revision, language),
    captions: {},
  })),
);

function input(overrides: Partial<ProjectionInput> & { unit?: ProjectionInput['unit'] } = {}) {
  return {
    unit: effectiveUnit({
      property,
      unit: unitRow(),
      propertyBlocks: [],
      unitBlocks: blocks,
      hiddenBlockIds: [],
      propertyAmenities: [{ amenity: 'wifi' as const, note: 'fast' }],
      unitAmenities: [],
    }),
    stay: {
      checkIn: '2026-10-21',
      checkout: '2026-10-24',
      partySize: 2,
      arrivalReleaseAt: RELEASE,
    },
    language: 'en' as GuestLanguage,
    translations,
    media: [] as ProjectionInput['media'],
    now: RELEASE,
    ...overrides,
  };
}

const unreleased = [...Object.values(SECRETS), ACCESS];
const afterReleaseTexts = (l: GuestLanguage) => [title(BLOCK_AFTER, 1, l), body(BLOCK_AFTER, 1, l)];

const moments = [
  { label: 'release − 1 ms', now: new Date(RELEASE.getTime() - 1), released: false },
  { label: 'release', now: RELEASE, released: true },
  { label: 'in stay', now: new Date('2026-10-22T12:00:00Z'), released: true },
  { label: 'after checkout', now: new Date('2026-10-26T12:00:00Z'), released: true },
];
const table = moments.flatMap((m) => GUEST_LANGUAGES.map((language) => ({ ...m, language })));

describe('guestProjection release gate', () => {
  it.each(table)('$label in $language', ({ now, released, language }) => {
    const p = guestProjection(input({ now, language }));
    const json = JSON.stringify(p);
    for (const value of [...unreleased, ...afterReleaseTexts(language)]) {
      expect(json.includes(value)).toBe(released);
    }
    expect(p.stay.arrivalDetailsReleased).toBe(released);
    if (released) {
      expect(p.arrival).toEqual({
        accessInstructions: ACCESS,
        buildingDoorCode: SECRETS.buildingDoorCode,
        doorCode: SECRETS.doorCode,
        lockboxCode: SECRETS.lockboxCode,
      });
      expect(p.wifi).toEqual({ network: 'Mare', password: SECRETS.wifiPassword });
      expect(p.contacts.hostPhone).toBe(SECRETS.hostPhone);
    } else {
      expect(p.arrival).toBeNull();
      expect(p.wifi).toEqual({ network: 'Mare', password: null });
      expect(p.contacts).toEqual({
        hostPhone: null,
        emergencyContactName: 'Ana',
        emergencyContactPhone: null,
      });
    }
  });
});

describe('guestProjection content', () => {
  it('never carries private host fields or ids', () => {
    const p = guestProjection(
      input({
        stay: {
          checkIn: '2026-10-21',
          checkout: '2026-10-24',
          partySize: 2,
          arrivalReleaseAt: RELEASE,
          // Extra Stay columns a caller might pass by mistake must not come through.
          ...({
            bookerName: PRIVATE.bookerName,
            reservationNumber: PRIVATE.reservationNumber,
            pin: PRIVATE.pin,
          } as object),
        } as ProjectionInput['stay'],
      }),
    );
    const json = JSON.stringify(p);
    for (const value of [...Object.values(PRIVATE), ...blocks.map((b) => b.id)]) {
      expect(json).not.toContain(value);
    }
    for (const key of [
      'approvedAt',
      'inherited',
      'arrivalReleaseDaysBefore',
      'revision',
      'source',
    ]) {
      expect(json).not.toContain(`"${key}"`);
    }
  });

  it('shows no Wi-Fi section when the unit has none', () => {
    const unit = effectiveUnit({
      property,
      unit: unitRow({ noWifi: true }),
      propertyBlocks: [],
      unitBlocks: [],
      hiddenBlockIds: [],
      propertyAmenities: [],
      unitAmenities: [],
    });
    expect(guestProjection(input({ unit })).wifi).toBeNull();
  });

  it('shows published blocks in the guest language at the published revision', () => {
    const p = guestProjection(input({ language: 'de' }));
    expect(p.blocks).toEqual([
      {
        category: 'arrival_access',
        title: title(BLOCK_AFTER, 1, 'de'),
        body: body(BLOCK_AFTER, 1, 'de'),
        media: [],
      },
      {
        category: 'wifi_essentials',
        title: title(BLOCK_ALWAYS, 1, 'de'),
        body: body(BLOCK_ALWAYS, 1, 'de'),
        media: [],
      },
      // The revised block keeps its revision-1 text while revision 2 is pending.
      {
        category: 'how_tos',
        title: title(BLOCK_REVISED, 1, 'de'),
        body: body(BLOCK_REVISED, 1, 'de'),
        media: [],
      },
    ]);
    const json = JSON.stringify(p);
    expect(json).not.toContain('block-3');
    expect(json).not.toContain('source title');
  });

  it('omits a block with no translation in the guest language', () => {
    const p = guestProjection(
      input({ translations: translations.filter((t) => t.language !== 'pl'), language: 'pl' }),
    );
    expect(p.blocks).toEqual([]);
  });

  it('copies the guest-safe core fields', () => {
    const p = guestProjection(input());
    expect(p.property).toMatchObject({
      name: 'Villa Mare',
      city: 'Trogir',
      location: { lat: 43.52, lng: 16.25 },
    });
    expect(p.unit).toEqual({
      name: 'Apartment 1',
      maxOccupancy: 4,
      bedrooms: 2,
      beds: [{ type: 'double', count: 1 }],
      bathrooms: 1,
    });
    expect(p.checkInOut.checkInTime).toBe('15:00:00');
    expect(p.stay).toEqual({
      checkIn: '2026-10-21',
      checkout: '2026-10-24',
      partySize: 2,
      arrivalDetailsReleased: true,
      arrivalDetailsReleaseAt: RELEASE.toISOString(),
    });
    expect(p.amenities).toEqual([{ amenity: 'wifi', note: 'fast' }]);
  });
});

describe('guestProjection media', () => {
  const MEDIA_OLD = 'm0m0m0m0-0000-4000-8000-000000000001';
  const MEDIA_NEW = 'm0m0m0m0-0000-4000-8000-000000000002';
  const MEDIA_AFTER = 'm0m0m0m0-0000-4000-8000-000000000003';
  const media: ProjectionInput['media'] = [
    // Added at revision 2 of the revised block, which still publishes revision 1.
    {
      id: MEDIA_NEW,
      blockId: BLOCK_REVISED,
      kind: 'video',
      caption: 'new source',
      addedRevision: 2,
      position: 1,
      createdAt: at,
    },
    {
      id: MEDIA_OLD,
      blockId: BLOCK_REVISED,
      kind: 'image',
      caption: 'old source',
      addedRevision: 1,
      position: 0,
      createdAt: at,
    },
    {
      id: MEDIA_AFTER,
      blockId: BLOCK_AFTER,
      kind: 'image',
      caption: 'lockbox',
      addedRevision: 1,
      position: 0,
      createdAt: at,
    },
  ];
  const withCaptions = translations.map((t) =>
    t.blockId === BLOCK_REVISED && t.revision === 1 && t.language === 'de'
      ? { ...t, captions: { [MEDIA_OLD]: 'alt de' } }
      : t,
  );
  const mediaOf = (p: ReturnType<typeof guestProjection>, category: string) =>
    p.blocks.find((b) => b.category === category)?.media;

  it('shows only the media of the published revision, with the caption in the language', () => {
    const p = guestProjection(input({ media, translations: withCaptions, language: 'de' }));
    expect(mediaOf(p, 'how_tos')).toEqual([{ id: MEDIA_OLD, kind: 'image', caption: 'alt de' }]);
  });

  it('shows media from the publication of the revision that added it', () => {
    const unit = effectiveUnit({
      property,
      unit: unitRow(),
      propertyBlocks: [],
      unitBlocks: [block(BLOCK_REVISED, { revision: 2, publishedRevision: 2 })],
      hiddenBlockIds: [],
      propertyAmenities: [],
      unitAmenities: [],
    });
    const p = guestProjection(input({ unit, media, translations: withCaptions }));
    expect(mediaOf(p, 'how_tos')?.map((m) => m.id)).toEqual([MEDIA_OLD, MEDIA_NEW]);
  });

  it('falls back to the source caption when the language row has none', () => {
    const p = guestProjection(input({ media, translations: withCaptions, language: 'en' }));
    expect(mediaOf(p, 'how_tos')).toEqual([
      { id: MEDIA_OLD, kind: 'image', caption: 'old source' },
    ]);
  });

  it('hides the media of an after-release block before the release', () => {
    const before = guestProjection(input({ media, now: new Date(RELEASE.getTime() - 1) }));
    expect(JSON.stringify(before)).not.toContain(MEDIA_AFTER);
    const after = guestProjection(input({ media }));
    expect(mediaOf(after, 'arrival_access')?.map((m) => m.id)).toEqual([MEDIA_AFTER]);
  });

  it('carries media ids but never block ids', () => {
    const json = JSON.stringify(guestProjection(input({ media })));
    for (const b of blocks) expect(json).not.toContain(b.id);
  });
});
