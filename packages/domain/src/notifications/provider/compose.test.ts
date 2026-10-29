import { describe, expect, it } from 'vitest';
import { CONTACT_FIELDS } from '../../offers/vocabulary';
import {
  composeProviderConfirmed,
  composeProviderRequest,
  guestFieldsFor,
  type ProviderConfirmedInput,
} from './compose';

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
  note: null,
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

describe('the guest note', () => {
  it('shows the translation with the original below', () => {
    const { text } = composeProviderConfirmed(
      input({ note: { text: 'Two child seats', translation: 'Dvije dječje sjedalice' } }),
    );
    expect(text).toContain('Napomena gosta: Dvije dječje sjedalice\nIzvorno: Two child seats');
  });

  it('shows the note alone when it is not translated', () => {
    const { text } = composeProviderConfirmed(
      input({ language: 'en', note: { text: 'Two child seats', translation: null } }),
    );
    expect(text).toContain('Guest note: Two child seats');
    expect(text).not.toContain('Original');
  });

  it('adds nothing without a note', () => {
    const { text } = composeProviderConfirmed(input());
    expect(text).not.toContain('Napomena');
    expect(text).not.toContain('Izvorno');
  });
});

describe('composeProviderRequest', () => {
  const request = { respondBy: '2027-05-01T12:30', priceMinor: 12050, currency: 'EUR' };

  it('asks for an answer by the due time, with the price when set', () => {
    const hr = composeProviderRequest({ ...input(), ...request });
    expect(hr.subject).toBe('Novi upit: Sunset kayak, 4.5.2027.');
    expect(hr.text).toContain('Molimo odgovorite do 1.5.2027. 12:30.');
    expect(hr.text).toMatch(/Cijena: 120,50\s€/);
    expect(hr.text).toContain('predložite drugo vrijeme');
    const en = composeProviderRequest({ ...input({ language: 'en' }), ...request });
    expect(en.text).toContain('Please answer by 1 May 2027 12:30.');
    expect(en.text).toContain('Price: €120.50');
  });

  it('has no price line before the Provider names one', () => {
    const { text } = composeProviderRequest({ ...input(), ...request, priceMinor: null });
    expect(text).not.toContain('Cijena');
  });
});
