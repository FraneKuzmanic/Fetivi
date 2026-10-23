import Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { cardStatusOf, createStripeGateway, gatewayErrorOf, PaymentGatewayError } from './gateway';

const invalid = (raw: Record<string, unknown>) =>
  new Stripe.errors.StripeInvalidRequestError({ type: 'invalid_request_error', ...raw });

describe('gatewayErrorOf', () => {
  it('maps the Stripe errors the payment job branches on', () => {
    const code = (error: unknown) => gatewayErrorOf(error).code;
    expect(
      code(
        invalid({
          code: 'payment_intent_unexpected_state',
          payment_intent: { status: 'succeeded' },
        }),
      ),
    ).toBe('intent-already-captured');
    expect(
      code(
        invalid({
          code: 'payment_intent_unexpected_state',
          payment_intent: { status: 'canceled' },
        }),
      ),
    ).toBe('intent-canceled');
    expect(code(invalid({ message: 'This Checkout Session is not open.' }))).toBe(
      'session-not-open',
    );
    expect(code(invalid({ param: 'expires_at', message: 'too soon' }))).toBe('expires-at-invalid');
    expect(code(new Stripe.errors.StripeIdempotencyError({ type: 'idempotency_error' }))).toBe(
      'idempotency-mismatch',
    );
    expect(code(new Stripe.errors.StripeConnectionError({ type: 'api_error' }))).toBe(
      'unavailable',
    );
    expect(code(invalid({ code: 'resource_missing' }))).toBe('rejected');
    expect(code(new TypeError('fetch failed'))).toBe('unavailable');
    const own = new PaymentGatewayError('card-declined');
    expect(gatewayErrorOf(own)).toBe(own);
  });
});

describe('cardStatusOf', () => {
  it('keeps the known statuses and treats the rest as restricted', () => {
    expect(cardStatusOf('active')).toBe('active');
    expect(cardStatusOf('pending')).toBe('pending');
    expect(cardStatusOf('rejected')).toBe('unsupported');
    expect(cardStatusOf(undefined)).toBe('restricted');
    expect(cardStatusOf('something_new')).toBe('restricted');
  });
});

describe('constructEvent', () => {
  const gateway = createStripeGateway({
    apiKey: 'sk_test_dummy',
    fetch: () => Promise.reject(new Error('no network in tests')),
  });
  const payload = JSON.stringify({ id: 'evt_1', type: 'customer.created', data: { object: {} } });
  const secret = 'whsec_test_secret';

  it('verifies the signature over the raw body', () => {
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
    expect(gateway.constructEvent(payload, header, secret)).toMatchObject({ id: 'evt_1' });
  });

  it('throws on a bad signature', () => {
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_other' });
    expect(() => gateway.constructEvent(payload, header, secret)).toThrow();
  });
});
