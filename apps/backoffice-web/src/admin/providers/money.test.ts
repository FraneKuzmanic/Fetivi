import { describe, expect, it } from 'vitest';
import { bpFromPercent, centsFromEuros, eurosFromCents, formatPrice, percentFromBp } from './money';

describe('money', () => {
  it('converts euros to cents without float drift', () => {
    expect(centsFromEuros(19.99)).toBe(1999);
    expect(centsFromEuros(45)).toBe(4500);
    expect(eurosFromCents(1999)).toBe(19.99);
  });

  it('converts percentages to basis points', () => {
    expect(bpFromPercent(12.5)).toBe(1250);
    expect(bpFromPercent(0.01)).toBe(1);
    expect(percentFromBp(1500)).toBe(15);
  });

  it('passes null through', () => {
    expect(centsFromEuros(null)).toBeNull();
    expect(eurosFromCents(null)).toBeNull();
    expect(bpFromPercent(null)).toBeNull();
  });

  it('formats a price with its unit, or a request', () => {
    expect(formatPrice(4500, 'EUR', 'person')).toBe('€45.00 per person');
    expect(formatPrice(25000, 'EUR', 'group')).toBe('€250.00 per group');
    expect(formatPrice(null, 'EUR', 'person')).toBe('Price on request');
  });
});
