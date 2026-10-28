import { describe, expect, it } from 'vitest';
import { composeHostOrderEmail, type HostOrderEmailInput } from './order-email';

const base: HostOrderEmailInput = {
  kind: 'provider_request',
  language: 'en',
  offerTitle: 'Airport transfer',
  date: '2027-05-04',
  startTime: null,
  quantity: 2,
  priceUnit: 'person',
  guest: {},
  respondBy: '2027-05-01T12:30',
  priceMinor: 5000,
  currency: 'EUR',
  acknowledge: false,
  inboxUrl: 'http://admin.test/inbox',
};

describe('composeHostOrderEmail', () => {
  it('asks for an answer by the deadline in the inbox', () => {
    const { subject, text } = composeHostOrderEmail(base);
    expect(subject).toBe('New request: Airport transfer');
    expect(text).toContain('Please answer by 1 May 2027 12:30 in your Fetivi inbox.');
    expect(text).toContain('Date: 4 May 2027');
    expect(text).toContain('People: 2');
    expect(text).toContain('Price: €50.00');
    expect(text).toContain('Accept, decline or suggest another time: http://admin.test/inbox');
    expect(text).not.toContain('Time:');
    expect(text).not.toContain('Guest');
  });

  it('tells of a confirmed Order with its time and the guest fields shared', () => {
    const { subject, text } = composeHostOrderEmail({
      ...base,
      kind: 'provider_confirmed',
      startTime: '09:00',
      respondBy: null,
      priceMinor: null,
      guest: { name: 'Ana', phone: '+385 91' },
      acknowledge: true,
    });
    expect(subject).toBe('New order: Airport transfer');
    expect(text).toContain('Time: 09:00');
    expect(text).toContain('Guest: Ana');
    expect(text).toContain('Guest phone: +385 91');
    expect(text).toContain('Open your inbox to confirm you got it: http://admin.test/inbox');
    expect(text).not.toContain('Price:');
    expect(text).not.toContain('answer by');
  });

  it('asks for no Got it on a confirmed request, and counts a group in people', () => {
    const { text } = composeHostOrderEmail({
      ...base,
      kind: 'provider_confirmed',
      priceUnit: 'group',
      quantity: 3,
      respondBy: null,
    });
    expect(text).toContain('People: 3');
    expect(text).toContain('See it in your inbox: http://admin.test/inbox');
    expect(text).not.toContain('confirm you got it');
  });

  it('writes to a Croatian host in Croatian, with day-first dates and a Croatian price', () => {
    const { subject, text } = composeHostOrderEmail({ ...base, language: 'hr' });
    expect(subject).toBe('Novi upit: Airport transfer');
    expect(text).toContain('Molimo odgovorite do 1.5.2027. 12:30 u svojim Fetivi porukama.');
    expect(text).toContain('Datum: 4.5.2027.');
    expect(text).toContain('Broj osoba: 2');
    expect(text).toMatch(/Cijena: 50,00\s€/);
    expect(text).toContain('Fetivi ne uzima proviziju na vaše vlastite usluge.');
  });
});
