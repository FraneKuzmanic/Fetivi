import { describe, expect, it } from 'vitest';
import { WIZARD_FIELDS } from '../wizard-config';
import { IMPORTABLE_FIELD_IDS, ManualExtraction, SECRET_COLUMNS } from './schema';

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
});
