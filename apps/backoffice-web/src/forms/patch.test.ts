import { describe, expect, it } from 'vitest';
import { inheritField, sectionBody } from './patch';

describe('sectionBody', () => {
  it('sends only the section fields and keeps null', () => {
    const draft = { checkInTime: '16:00', checkoutTime: null, name: 'Apartment 1' };
    expect(sectionBody(draft, ['checkInTime', 'checkoutTime'])).toEqual({
      checkInTime: '16:00',
      checkoutTime: null,
    });
  });
});

describe('inheritField', () => {
  it('clears the override so the unit inherits', () => {
    const draft = { checkInTime: '16:00', petsAllowed: false };
    expect(sectionBody(inheritField(draft, 'petsAllowed'), ['petsAllowed'])).toEqual({
      petsAllowed: null,
    });
  });
});
