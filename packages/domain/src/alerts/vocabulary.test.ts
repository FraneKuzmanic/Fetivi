import { describe, expect, it } from 'vitest';
import { FERRY_OPERATOR_INFO, ferryLineLabel, lineOperator } from './vocabulary';

describe('ferryLineLabel', () => {
  it('gives a numbered line its number and a line without one its route', () => {
    expect(ferryLineLabel('9603')).toBe('9603');
    expect(ferryLineLabel('bura-line')).toBe('Trogir – Slatine – Split');
    expect(ferryLineLabel('unknown-slug')).toBe('unknown-slug');
  });
});

describe('lineOperator', () => {
  it("gives the line's operator, else 'other'", () => {
    expect(lineOperator('9608')).toBe(FERRY_OPERATOR_INFO.tp_line);
    expect(lineOperator('999')).toBe(FERRY_OPERATOR_INFO.other);
    expect(lineOperator(undefined)).toBe(FERRY_OPERATOR_INFO.other);
  });
});
