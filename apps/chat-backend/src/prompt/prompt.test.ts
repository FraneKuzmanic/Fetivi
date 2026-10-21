import type { GuestProjection } from '@fetivi/domain';
import { describe, expect, it } from 'vitest';
import { INSTRUCTIONS } from './instructions';
import { buildSystemText, projectionChangeNote, situationNote, systemInstructions } from './prompt';

const projection: GuestProjection = {
  language: 'en',
  property: {
    name: 'Villa',
    addressLine: null,
    city: 'Trogir',
    postalCode: null,
    country: 'HR',
    timezone: 'Europe/Zagreb',
    location: null,
  },
  unit: { name: 'Apartment', maxOccupancy: 4, bedrooms: 1, beds: [], bathrooms: 1 },
  stay: {
    checkIn: '2026-10-23',
    checkout: '2026-10-26',
    partySize: 2,
    arrivalDetailsReleased: false,
    arrivalDetailsReleaseAt: '2026-10-21T22:00:00.000Z',
  },
  checkInOut: { checkInTime: '15:00', checkoutTime: '10:00', checkInMethod: null },
  arrival: null,
  wifi: { network: 'Net', password: null },
  parking: { type: null, notes: null },
  houseRules: {
    petsAllowed: null,
    smokingAllowed: null,
    partiesAllowed: null,
    quietHoursFrom: null,
    quietHoursTo: null,
    notes: null,
  },
  contacts: { hostPhone: null, emergencyContactName: 'Ana', emergencyContactPhone: null },
  amenities: [],
  blocks: [{ category: 'wifi_essentials', title: 'Wifi', body: 'Router in the hall.' } as never],
};

const released: GuestProjection = {
  ...projection,
  stay: { ...projection.stay, arrivalDetailsReleased: true },
  arrival: {
    accessInstructions: 'Blue gate',
    buildingDoorCode: '1',
    doorCode: '2',
    lockboxCode: '3',
  },
  wifi: { network: 'Net', password: 'secret' },
  contacts: { ...projection.contacts, hostPhone: '+385', emergencyContactPhone: '+386' },
  blocks: [...projection.blocks, { category: 'arrival_access', title: 'A', body: 'B' } as never],
};

const updateOf = (note: string) =>
  JSON.parse(note.split('<unit_record_update>\n')[1]?.split('\n</unit_record_update>')[0] ?? '');

describe('system text', () => {
  it('is the instructions then the projection, byte-identical for equal input', () => {
    const a = buildSystemText(projection);
    expect(a.startsWith(INSTRUCTIONS)).toBe(true);
    expect(a).toContain(`<unit_record>\n${JSON.stringify(projection)}\n</unit_record>`);
    expect(buildSystemText(structuredClone(projection))).toBe(a);
  });

  it('puts the cache breakpoint on its single block', () => {
    expect(systemInstructions('text')).toEqual([
      {
        role: 'system',
        content: 'text',
        providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
      },
    ]);
  });
});

describe('projectionChangeNote', () => {
  it('is null when nothing changed', () => {
    expect(projectionChangeNote(projection, structuredClone(projection))).toBeNull();
  });

  it('ignores key order, which jsonb does not keep', () => {
    const reordered = JSON.parse(
      JSON.stringify(projection, (_k, v) =>
        v && typeof v === 'object' && !Array.isArray(v)
          ? Object.fromEntries(Object.entries(v).reverse())
          : v,
      ),
    );
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(projection));
    expect(projectionChangeNote(reordered, projection)).toBeNull();
  });

  it('carries only the changed sections', () => {
    const after = { ...projection, parking: { type: null, notes: 'Street' } };
    const note = projectionChangeNote(projection, after) ?? '';
    expect(note.startsWith('The unit record changed.')).toBe(true);
    expect(updateOf(note)).toEqual({ parking: { type: null, notes: 'Street' } });
  });

  it('carries exactly the sections the release opens', () => {
    const note = projectionChangeNote(projection, released) ?? '';
    expect(Object.keys(updateOf(note))).toEqual(['stay', 'arrival', 'wifi', 'contacts', 'blocks']);
    expect(note).not.toContain('switched the language');
  });

  it('adds the switch line on a language change', () => {
    const note = projectionChangeNote(projection, { ...projection, language: 'de' }) ?? '';
    expect(updateOf(note)).toEqual({ language: 'de' });
    expect(note).toContain(
      'The guest switched the language to German; answer in German from now on.',
    );
  });
});

describe('situationNote', () => {
  const base = {
    timezone: 'Europe/Zagreb',
    checkIn: '2026-10-23',
    checkout: '2026-10-26',
    phase: 'upcoming' as const,
  };

  it('rounds down to 15 minutes in the property zone', () => {
    expect(situationNote({ ...base, now: new Date('2026-10-21T12:14:59Z') })).toBe(
      'Situation: it is Wednesday 21 October 2026, 14:00 in Europe/Zagreb. The stay runs from Friday 23 October 2026 to Monday 26 October 2026; the guests have not arrived yet.',
    );
    expect(situationNote({ ...base, now: new Date('2026-10-21T12:15:00Z') })).toContain(
      '14:15 in Europe/Zagreb',
    );
  });

  it('follows the zone across the DST change', () => {
    // CEST (UTC+2) on Saturday, CET (UTC+1) on Sunday after 03:00.
    expect(situationNote({ ...base, now: new Date('2026-10-24T10:00:00Z') })).toContain(
      'Saturday 24 October 2026, 12:00',
    );
    expect(situationNote({ ...base, now: new Date('2026-10-25T10:00:00Z') })).toContain(
      'Sunday 25 October 2026, 11:00',
    );
  });

  it('words each phase', () => {
    const now = new Date('2026-10-21T12:00:00Z');
    expect(situationNote({ ...base, now })).toContain('the guests have not arrived yet.');
    expect(situationNote({ ...base, now, phase: 'in_stay' })).toContain(
      'the guests are staying now.',
    );
    expect(situationNote({ ...base, now, phase: 'ended' })).toContain(
      'the guests have checked out.',
    );
  });
});
