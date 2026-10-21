import { describe, expect, it } from 'vitest';
import { WIZARD_FIELDS } from '../wizard-config';
import { draftStep, IMPORTABLE_FIELD_IDS, ManualExtraction, SECRET_COLUMNS } from './schema';

describe('manual import schema', () => {
  it('imports every property, unit and core field except the location and the arrival release', () => {
    const derived = WIZARD_FIELDS.filter(
      (f) =>
        ['property', 'unit', 'core'].includes(f.kind) &&
        f.id !== 'location' &&
        f.id !== 'arrival_release',
    ).map((f) => f.id);
    expect([...IMPORTABLE_FIELD_IDS]).toEqual(derived);
  });

  it('has an extraction field for exactly the columns of the importable fields', () => {
    const columns = WIZARD_FIELDS.filter((f) =>
      (IMPORTABLE_FIELD_IDS as readonly string[]).includes(f.id),
    ).flatMap((f) => f.columns);
    expect(Object.keys(ManualExtraction.shape.fields.shape).sort()).toEqual(
      [...new Set(columns)].sort(),
    );
  });

  it('has an extraction field for every secret column', () => {
    const keys = Object.keys(ManualExtraction.shape.fields.shape);
    for (const column of SECRET_COLUMNS) expect(keys).toContain(column);
  });

  it('derives the wizard step of each draft kind', () => {
    const base = { id: 'd1', status: 'pending' } as const;
    expect(draftStep({ ...base, kind: 'field', fieldId: 'checkout_time', values: {} })).toBe(
      'house_rules_checkout',
    );
    expect(draftStep({ ...base, kind: 'amenities', amenities: [] })).toBe('wifi_essentials');
    expect(
      draftStep({
        ...base,
        kind: 'block',
        category: 'how_tos',
        wizardKey: null,
        title: 't',
        body: 'b',
        scrubbed: false,
        warnings: [],
      }),
    ).toBe('how_tos');
    expect(draftStep({ ...base, kind: 'unmapped', text: 'x', fieldId: null })).toBeNull();
  });
});
