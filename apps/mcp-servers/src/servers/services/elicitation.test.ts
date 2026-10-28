import { randomUUID } from 'node:crypto';
import {
  type CancellationTerms,
  type CancelOrderDraft,
  type CreateOrderDraft,
  ORDER_DRAFT_META_KEY,
  type RespondOrderDraft,
} from '@fetivi/domain';
import { inputRequired } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { cancelMessage } from './cancel';
import { confirmationMessage, contactSchemaFor, orderDraftMeta } from './elicitation';
import { respondMessage } from './respond';
import { termsSentence } from './terms';

const terms: CancellationTerms = {
  freeCancelHoursBefore: 24,
  lateChargePercent: 50,
  freeUntil: '2027-05-03T07:00:00.000Z',
  freeUntilLocal: '2027-05-03T09:00',
  freeWindowPassed: false,
};
const passed: CancellationTerms = { ...terms, freeWindowPassed: true };

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
  cancellation: terms,
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
      'Book Blue Lagoon boat trip on 2027-05-04 at 09:00 for 2, 90.00 EUR total, paid directly to the provider? Free cancellation until 2027-05-03 09:00; after that the provider may ask for 50 % of the price directly.',
    );
  });

  it('says a pay-online booking is charged only once confirmed', () => {
    expect(confirmationMessage({ ...draft, paymentMode: 'online' })).toBe(
      'Book Blue Lagoon boat trip on 2027-05-04 at 09:00 for 2, 90.00 EUR total, paid online after you confirm (your card is charged only once the booking is confirmed)? Free cancellation until 2027-05-03 09:00; after that cancelling costs 50 % of the price.',
    );
  });
});

describe('termsSentence', () => {
  it('never says refund for a pay-direct order', () => {
    for (const t of [terms, passed, { ...terms, lateChargePercent: 100 }]) {
      expect(termsSentence(t, 'direct', false)).not.toMatch(/refund/i);
    }
    expect(termsSentence(passed, 'direct', false)).toBe(
      "The provider's late-cancellation terms apply: they may ask for 50 % of the price directly.",
    );
    expect(termsSentence({ ...terms, lateChargePercent: 100 }, 'direct', false)).toContain(
      'the full price',
    );
  });

  it('speaks of refunds for an order paid online', () => {
    expect(termsSentence(passed, 'online', true)).toBe(
      'Free cancellation has ended: 50 % of what you paid is refunded.',
    );
    expect(termsSentence({ ...passed, lateChargePercent: 100 }, 'online', true)).toBe(
      'Free cancellation has ended: nothing is refunded.',
    );
  });

  it('speaks of a cost, never a refund, for an online order not paid yet', () => {
    expect(termsSentence(terms, 'online', false)).toBe(
      'Free cancellation until 2027-05-03 09:00; after that cancelling costs 50 % of the price.',
    );
    expect(termsSentence(passed, 'online', false)).toBe(
      'Free cancellation has ended: cancelling costs 50 % of the price.',
    );
  });

  it('is free at any time under a 0 % late charge, and empty without terms', () => {
    expect(termsSentence({ ...terms, lateChargePercent: 0 }, 'direct', false)).toBe(
      'Cancelling is free at any time.',
    );
    expect(termsSentence(null, 'online', true)).toBe('');
  });
});

describe('cancelMessage', () => {
  const cancel: CancelOrderDraft = {
    orderId: randomUUID(),
    proposalId: randomUUID(),
    offerTitle: 'Private sunset cruise',
    language: 'en',
    date: '2027-05-04',
    startsAtLocal: '2027-05-04T19:00',
    quantity: 4,
    paymentMode: 'direct',
    paymentStatus: 'none',
    priceMinor: 25000,
    currency: 'EUR',
    cancellationPolicy: 'Free until 48 hours before; after that 50 % is refunded.',
    refundMinor: null,
    refundPercent: null,
    freeUntil: null,
    freeUntilLocal: null,
    cancellation: passed,
  };

  it('never mentions a refund for a pay-direct order, nor the policy text', () => {
    const message = cancelMessage(cancel);
    expect(message).not.toMatch(/refund/i);
    expect(message).toBe(
      "Cancel Private sunset cruise on 2027-05-04 at 19:00 for 4? It was paid directly to the provider. The provider's late-cancellation terms apply: they may ask for 50 % of the price directly.",
    );
  });

  it('shows the refund of a captured online payment', () => {
    expect(
      cancelMessage({
        ...cancel,
        paymentMode: 'online',
        paymentStatus: 'captured',
        refundMinor: 12500,
        refundPercent: 50,
      }),
    ).toContain('You get back 125.00 EUR (50 %).');
  });

  it('says an unpaid online order costs nothing to cancel', () => {
    expect(cancelMessage({ ...cancel, paymentMode: 'online' })).toContain(
      'Nothing was paid yet, so cancelling costs nothing.',
    );
  });
});

describe('respondMessage', () => {
  it('states the terms for the new start without the policy text', () => {
    const respond: RespondOrderDraft = {
      orderId: randomUUID(),
      proposalId: randomUUID(),
      offerTitle: 'Private sunset cruise',
      language: 'en',
      proposer: 'provider_time',
      date: '2027-05-05',
      startsAtLocal: '2027-05-05T19:00',
      quantity: 4,
      priceMinor: 25000,
      currency: 'EUR',
      previous: { date: '2027-05-04', startsAtLocal: '2027-05-04T19:00', priceMinor: 25000 },
      paymentMode: 'direct',
      cancellationPolicy: 'after that 50 % is refunded',
      respondBy: '2027-05-04T10:00:00.000Z',
      respondByLocal: '2027-05-04T12:00',
      cancellation: terms,
    };
    const message = respondMessage(respond);
    expect(message).not.toMatch(/refund/i);
    expect(message).toContain('Free cancellation until 2027-05-03 09:00');
  });
});
