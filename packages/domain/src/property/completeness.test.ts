import { describe, expect, it } from 'vitest';
import { fieldLevel, isFilled, resumeStep, visibleFields, wizardProgress } from './completeness';
import { facts, MINIMUM } from './wizard.fixtures';
import { answersPrompt, WIZARD_FIELDS, type WizardFieldId, wizardField } from './wizard-config';

const level = (id: WizardFieldId, f = facts()) => fieldLevel(wizardField(id), f);
const visibleIds = (f: ReturnType<typeof facts>) =>
  WIZARD_FIELDS.filter((x) => fieldLevel(x, f) !== 'hidden').map((x) => x.id);

describe('property-type branching', () => {
  it('uses base levels while the type is not chosen', () => {
    expect(level('building_door_code')).toBe('optional');
    expect(level('quiet_hours')).toBe('optional');
    expect(level('shared_spaces')).toBe('hidden');
    expect(level('pool_outdoor')).toBe('hidden');
  });

  it('hides the building door code for a house or a villa', () => {
    expect(visibleIds(facts({}, { propertyType: 'house' }))).not.toContain('building_door_code');
    expect(visibleIds(facts({}, { propertyType: 'villa' }))).not.toContain('building_door_code');
    expect(visibleIds(facts({}, { propertyType: 'apartment' }))).toContain('building_door_code');
  });

  it('asks a room about shared spaces and not about hot water', () => {
    const room = facts({}, { propertyType: 'room' });
    expect(level('shared_spaces', room)).toBe('recommended');
    expect(level('hot_water', room)).toBe('hidden');
  });

  it('recommends the pool for a villa and hides it for an apartment', () => {
    expect(level('pool_outdoor', facts({}, { propertyType: 'villa' }))).toBe('recommended');
    expect(level('pool_outdoor', facts({}, { propertyType: 'house' }))).toBe('optional');
    expect(level('pool_outdoor', facts({}, { propertyType: 'apartment' }))).toBe('hidden');
  });

  it('recommends quiet hours in buildings and rubbish rules for houses', () => {
    expect(level('quiet_hours', facts({}, { propertyType: 'apartment' }))).toBe('recommended');
    expect(level('quiet_hours', facts({}, { propertyType: 'villa' }))).toBe('optional');
    expect(level('rubbish_recycling', facts({}, { propertyType: 'house' }))).toBe('recommended');
  });
});

describe('check-in method branching', () => {
  it('recommends the lockbox code for a lockbox and hides it for in-person', () => {
    expect(level('lockbox_code', facts({ checkInMethod: 'lockbox' }))).toBe('recommended');
    expect(level('lockbox_code', facts({ checkInMethod: 'in_person' }))).toBe('hidden');
    expect(level('lockbox_code', facts({ checkInMethod: 'building_staff' }))).toBe('hidden');
    expect(level('lockbox_code')).toBe('optional');
  });

  it('recommends the door code for keypads and smart locks', () => {
    expect(level('door_code', facts({ checkInMethod: 'keypad' }))).toBe('recommended');
    expect(level('door_code', facts({ checkInMethod: 'smart_lock' }))).toBe('recommended');
    expect(level('door_code', facts({ checkInMethod: 'lockbox' }))).toBe('optional');
  });

  it('lets a type hide win over the method level', () => {
    const villaKeypad = facts({ checkInMethod: 'keypad' }, { propertyType: 'villa' });
    expect(level('building_door_code', villaKeypad)).toBe('hidden');
    const roomLockbox = facts({ checkInMethod: 'lockbox' }, { propertyType: 'room' });
    expect(level('lockbox_code', roomLockbox)).toBe('recommended');
  });

  it('lists the visible fields of a step in order', () => {
    const ids = visibleFields('arrival_access', facts({ checkInMethod: 'in_person' })).map(
      (f) => f.id,
    );
    expect(ids[0]).toBe('address');
    expect(ids).not.toContain('lockbox_code');
  });
});

describe('filled', () => {
  it('needs both street and city for the address', () => {
    expect(isFilled('address', facts({ addressLine: 'Obala 1' }))).toBe(false);
    expect(isFilled('address', facts({ addressLine: 'Obala 1', city: 'Trogir' }))).toBe(true);
  });

  it('counts a prompt as filled when a block carries its key', () => {
    const f = facts(
      {},
      {
        blocks: [
          { wizardKey: 'checkout_steps', category: 'how_tos', revision: 1, publishedRevision: 1 },
        ],
      },
    );
    expect(isFilled('checkout_steps', f)).toBe(true);
    expect(isFilled('laundry', f)).toBe(false);
  });

  it('counts amenities and beds', () => {
    expect(isFilled('amenities', facts({}, { amenityCount: 2 }))).toBe(true);
    expect(isFilled('rooms_beds', facts({ beds: [{ type: 'double', count: 1 }] }))).toBe(true);
    expect(isFilled('rooms_beds', facts({ bedrooms: 2 }))).toBe(false);
  });
});

describe('completeness', () => {
  it('counts Required and Recommended fields only', () => {
    const empty = wizardProgress(facts());
    expect(empty.percent).toBe(0);
    const optionalOnly = wizardProgress(facts({ houseRulesNotes: 'No shoes', doorCode: '1' }));
    expect(optionalOnly.filled).toBe(0);
    expect(optionalOnly.total).toBe(empty.total);
    const minimum = wizardProgress(facts(MINIMUM));
    expect(minimum.filled).toBe(7);
    expect(minimum.percent).toBe(Math.round((100 * 7) / minimum.total));
  });

  it('treats saved places as complete', () => {
    expect(wizardProgress(facts()).steps.saved_places).toEqual({
      filled: 0,
      total: 0,
      missingRequired: [],
      missingRecommended: [],
    });
  });
});

describe('resume', () => {
  it('resumes an empty unit at arrival', () => {
    expect(resumeStep(facts())).toBe('arrival_access');
  });

  it('moves on to Wi-Fi once the arrival Required fields are filled', () => {
    const { noWifi, checkoutTime, hostPhone, ...arrival } = MINIMUM;
    expect(resumeStep(facts(arrival))).toBe('wifi_essentials');
  });

  it('goes to the first step missing a Recommended field once all Required are filled', () => {
    expect(resumeStep(facts(MINIMUM))).toBe('arrival_access');
    const arrivalDone = facts(
      { ...MINIMUM, location: true, lockboxCode: '1' },
      {
        blocks: [
          {
            wizardKey: 'arrival_directions',
            category: 'how_tos',
            revision: 1,
            publishedRevision: 1,
          },
        ],
      },
    );
    expect(resumeStep(arrivalDone)).toBe('wifi_essentials');
  });

  it('returns null when everything is filled', () => {
    const keys = ['arrival_directions', 'checkout_steps', 'heating_cooling', 'neighbourhood_tips'];
    const all = facts(
      {
        ...MINIMUM,
        location: true,
        lockboxCode: '1',
        parkingType: 'none',
        maxOccupancy: 2,
        beds: [{ type: 'double', count: 1 }],
        petsAllowed: false,
        smokingAllowed: false,
        partiesAllowed: false,
        licenceNumber: 'L1',
        emergencyContactPhone: '+385 98 000 0000',
      },
      {
        amenityCount: 1,
        blocks: keys.map((wizardKey) => ({
          wizardKey,
          category: 'how_tos' as const,
          revision: 1,
          publishedRevision: 1,
        })),
      },
    );
    expect(resumeStep(all)).toBeNull();
    expect(wizardProgress(all).percent).toBe(100);
  });
});

describe('answersPrompt', () => {
  it('matches by key, and by section only where one prompt writes to it', () => {
    expect(answersPrompt({ wizardKey: 'laundry', category: 'how_tos' }, 'laundry')).toBe(true);
    expect(answersPrompt({ wizardKey: 'laundry', category: 'how_tos' }, 'hot_water')).toBe(false);
    // Tips written on the Host picks page carry no key; host_picks has a single prompt.
    expect(answersPrompt({ wizardKey: null, category: 'host_picks' }, 'neighbourhood_tips')).toBe(
      true,
    );
    // How-tos has several prompts: an entry without a key answers none of them.
    expect(answersPrompt({ wizardKey: null, category: 'how_tos' }, 'laundry')).toBe(false);
  });
});
