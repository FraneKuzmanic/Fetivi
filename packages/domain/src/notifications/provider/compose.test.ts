import { describe, expect, it } from 'vitest';
import { CONTACT_FIELDS } from '../../offers/vocabulary';
import { composeProviderConfirmed, guestFieldsFor, type ProviderConfirmedInput } from './compose';

const GUEST = { guestName: 'Ana Horvat', guestPhone: '+385 91 123 4567' };
const EMAIL = 'ana@example.test';

const input = (over: Partial<ProviderConfirmedInput> = {}): ProviderConfirmedInput => ({
  language: 'hr',
  providerName: 'Kayak Trogir',
  offerTitle: 'Sunset kayak',
  date: '2027-05-04',
  startTime: '09:00',
  quantity: 2,
  priceUnit: 'person',
  guest: guestFieldsFor('name_and_phone', GUEST),
  link: 'https://host.fetivi.test/api/provider-link/abc',
  ...over,
});

describe('guestFieldsFor', () => {
  it('keeps only the configured fields', () => {
    expect(guestFieldsFor('name', GUEST)).toEqual({ name: 'Ana Horvat' });
    expect(guestFieldsFor('phone', GUEST)).toEqual({ phone: '+385 91 123 4567' });
    expect(guestFieldsFor('name_and_phone', GUEST)).toEqual({
      name: 'Ana Horvat',
      phone: '+385 91 123 4567',
    });
    expect(guestFieldsFor('name_and_phone', { guestName: null, guestPhone: null })).toEqual({});
  });
});

describe('composeProviderConfirmed', () => {
  it('shows only the configured guest fields, never the email', () => {
    for (const fields of CONTACT_FIELDS) {
      const { text } = composeProviderConfirmed(input({ guest: guestFieldsFor(fields, GUEST) }));
      expect(text.includes('Ana Horvat'), fields).toBe(fields !== 'phone');
      expect(text.includes('+385 91 123 4567'), fields).toBe(fields !== 'name');
      expect(text).not.toContain(EMAIL);
    }
  });

  it('writes Croatian by default and English on request', () => {
    const hr = composeProviderConfirmed(input());
    const en = composeProviderConfirmed(input({ language: 'en' }));
    expect(hr.subject).toBe('Nova narudžba: Sunset kayak, 4.5.2027.');
    expect(en.subject).toBe('New order: Sunset kayak, 4 May 2027');
    expect(hr.text).toContain('Broj osoba: 2');
    expect(en.text).toContain('Persons: 2');
    expect(hr.text).not.toBe(en.text);
  });

  it('carries the link and no empty values', () => {
    const { text } = composeProviderConfirmed(input({ startTime: null, guest: {} }));
    expect(text).toContain('https://host.fetivi.test/api/provider-link/abc');
    expect(text).not.toMatch(/undefined|null/);
    expect(text).not.toContain('Vrijeme');
    expect(text).not.toContain('Gost');
  });
});
