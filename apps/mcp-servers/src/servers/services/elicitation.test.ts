import { randomUUID } from 'node:crypto';
import { type CreateOrderDraft, ORDER_DRAFT_META_KEY } from '@fetivi/domain';
import { inputRequired } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { confirmationMessage, contactSchemaFor, orderDraftMeta } from './elicitation';

const draft: CreateOrderDraft = {
  offerId: randomUUID(),
  offerTitle: 'Blue Lagoon boat trip',
  language: 'en',
  date: '2027-05-04',
  slotId: randomUUID(),
  startsAt: '2027-05-04T07:00:00.000Z',
  startsAtLocal: '2027-05-04T09:00',
  quantity: 2,
  priceMinor: 9000,
  currency: 'EUR',
  priceUnit: 'person',
  paymentMode: 'direct',
  availabilityMode: 'allotment',
  cancellationPolicy: 'Free until 24 hours before.',
  contactFields: 'name_and_phone',
};

describe('contactSchemaFor', () => {
  it('always asks for email, plus the configured fields', () => {
    const keys = (f: Parameters<typeof contactSchemaFor>[0]) =>
      Object.keys(contactSchemaFor(f).shape).sort();
    expect(keys('name')).toEqual(['email', 'name']);
    expect(keys('phone')).toEqual(['email', 'phone']);
    expect(keys('name_and_phone')).toEqual(['email', 'name', 'phone']);
  });

  it('validates the answer', () => {
    const schema = contactSchemaFor('name_and_phone');
    expect(
      schema.safeParse({ email: 'a@b.test', name: ' Ana ', phone: '+385 91 000' }).data,
    ).toEqual({ email: 'a@b.test', name: 'Ana', phone: '+385 91 000' });
    expect(schema.safeParse({ email: 'nope', name: 'Ana', phone: '+385 91 000' }).success).toBe(
      false,
    );
    expect(schema.safeParse({ email: 'a@b.test', name: ' ', phone: '+385 91 000' }).success).toBe(
      false,
    );
    expect(schema.safeParse({ email: 'a@b.test', name: 'Ana', phone: 'call me' }).success).toBe(
      false,
    );
  });

  it('converts to a form-mode elicitation with every field required and the draft in _meta', () => {
    const request = inputRequired.elicit({
      message: confirmationMessage(draft),
      requestedSchema: contactSchemaFor('name_and_phone'),
      _meta: orderDraftMeta('p-1', draft),
    });
    expect(request.params).toMatchObject({
      mode: 'form',
      requestedSchema: {
        type: 'object',
        properties: { email: { type: 'string', format: 'email' } },
      },
      _meta: { [ORDER_DRAFT_META_KEY]: { pendingId: 'p-1', offerId: draft.offerId } },
    });
    const schema = (request.params as { requestedSchema: { required?: string[] } }).requestedSchema;
    expect(schema.required?.sort()).toEqual(['email', 'name', 'phone']);
  });
});

describe('confirmationMessage', () => {
  it('is built from the stored draft only', () => {
    expect(confirmationMessage(draft)).toBe(
      'Book Blue Lagoon boat trip on 2027-05-04 at 09:00 for 2, 90.00 EUR total, paid directly to the provider? Cancellation policy: Free until 24 hours before.',
    );
  });

  it('says a pay-online booking is charged only once confirmed', () => {
    expect(confirmationMessage({ ...draft, paymentMode: 'online' })).toBe(
      'Book Blue Lagoon boat trip on 2027-05-04 at 09:00 for 2, 90.00 EUR total, paid online after you confirm (your card is charged only once the booking is confirmed)? Cancellation policy: Free until 24 hours before.',
    );
  });
});
