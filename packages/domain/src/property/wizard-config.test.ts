import { describe, expect, it } from 'vitest';
import { GO_LIVE_FIELD_ITEMS } from './go-live';
import { CHECK_IN_METHODS, HOST_BLOCK_CATEGORIES, PROPERTY_TYPES } from './vocabulary';
import {
  levelFor,
  WIZARD_FIELDS,
  WIZARD_PROMPT_KEYS,
  WIZARD_STEP_IDS,
  wizardStepPath,
} from './wizard';
import { WIZARD_COPY } from './wizard-copy';

describe('wizard config', () => {
  it('pins the step ids Suggestions link to', () => {
    expect([...WIZARD_STEP_IDS]).toEqual([
      'arrival_access',
      'wifi_essentials',
      'house_rules_checkout',
      'how_tos',
      'saved_places',
      'host_picks',
      'contacts_emergency',
    ]);
  });

  it('has unique field ids', () => {
    const ids = WIZARD_FIELDS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every prompt a host block category', () => {
    for (const field of WIZARD_FIELDS.filter((f) => f.kind === 'prompt')) {
      expect(HOST_BLOCK_CATEGORIES).toContain(field.prompt?.category);
    }
    expect(WIZARD_PROMPT_KEYS).toContain('checkout_steps');
    expect(WIZARD_PROMPT_KEYS).not.toContain('wifi');
  });

  it('makes the Required fields exactly the go-live minimum, never hidden or downgraded', () => {
    const required = WIZARD_FIELDS.filter((f) => f.level === 'required').map((f) => f.id);
    expect(required.sort()).toEqual([...GO_LIVE_FIELD_ITEMS].sort());
    for (const field of WIZARD_FIELDS.filter((f) => f.level === 'required')) {
      for (const type of [null, ...PROPERTY_TYPES]) {
        for (const method of [null, ...CHECK_IN_METHODS]) {
          expect(levelFor(field, type, method)).toBe('required');
        }
      }
    }
    for (const field of WIZARD_FIELDS.filter((f) => f.level !== 'required')) {
      for (const type of [null, ...PROPERTY_TYPES]) {
        for (const method of [null, ...CHECK_IN_METHODS]) {
          expect(levelFor(field, type, method)).not.toBe('required');
        }
      }
    }
  });

  it('builds step paths, with an optional field anchor', () => {
    expect(wizardStepPath('u1', 'how_tos')).toBe('/units/u1/setup/how_tos');
    expect(wizardStepPath('u1', 'arrival_access', 'door_code')).toBe(
      '/units/u1/setup/arrival_access#field-door_code',
    );
  });
});

describe('wizard copy', () => {
  /** Every leaf string of a copy object, with its path. */
  function leaves(value: unknown, path: string): [string, unknown][] {
    if (value !== null && typeof value === 'object') {
      return Object.entries(value).flatMap(([k, v]) => leaves(v, `${path}.${k}`));
    }
    return [[path, value]];
  }

  it.each(Object.keys(WIZARD_COPY))(
    '%s has a non-empty string everywhere English has one',
    (lang) => {
      const copy = WIZARD_COPY[lang as keyof typeof WIZARD_COPY];
      const english = new Map(leaves(WIZARD_COPY.en, ''));
      const own = new Map(leaves(copy, ''));
      for (const path of english.keys()) {
        const value = own.get(path);
        expect(typeof value, path).toBe('string');
        expect((value as string).trim(), path).not.toBe('');
      }
      expect(own.size).toBe(english.size);
    },
  );

  it('covers every step, field and prompt', () => {
    for (const step of WIZARD_STEP_IDS) expect(WIZARD_COPY.en.steps[step].title).toBeTruthy();
    for (const field of WIZARD_FIELDS) {
      expect(WIZARD_COPY.en.fields[field.id].why).toBeTruthy();
      expect(WIZARD_COPY.en.fields[field.id].example).toBeTruthy();
    }
    for (const key of WIZARD_PROMPT_KEYS)
      expect(WIZARD_COPY.en.prompts[key].defaultTitle).toBeTruthy();
  });
});
