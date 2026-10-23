import { describe, expect, it } from 'vitest';
import { applicationFee, isCardOnly, stripeIdempotencyKey } from './keys';

const orderId = '0b6f3c1e-2a4d-4e8f-9c1b-5d7e8f9a0b1c';

describe('stripeIdempotencyKey', () => {
  it('names the Order, the proposal, the operation and the stored expiry', () => {
    const expiresAt = new Date(1_788_256_800_000);
    expect(stripeIdempotencyKey({ orderId, proposalVersion: 1, expiresAt }, 'create_session')).toBe(
      `order:${orderId}:proposal:1:create_session:1788256800`,
    );
  });

  it('changes when the attempt is restamped, and only then', () => {
    const a = { orderId, proposalVersion: 1, expiresAt: new Date(1_788_256_800_000) };
    const same = { ...a, expiresAt: new Date(1_788_256_800_400) };
    const later = { ...a, expiresAt: new Date(1_788_256_920_000) };
    expect(stripeIdempotencyKey(same, 'capture')).toBe(stripeIdempotencyKey(a, 'capture'));
    expect(stripeIdempotencyKey(later, 'capture')).not.toBe(stripeIdempotencyKey(a, 'capture'));
    expect(stripeIdempotencyKey(a, 'cancel')).not.toBe(stripeIdempotencyKey(a, 'capture'));
  });
});

describe('applicationFee', () => {
  it('takes the commission in basis points, rounded down', () => {
    expect(applicationFee(2500, 1250)).toBe(312);
    expect(applicationFee(5000, 1250)).toBe(625);
    expect(applicationFee(5000, 0)).toBe(0);
    expect(applicationFee(5000, 10_000)).toBe(5000);
  });
});

describe('isCardOnly', () => {
  it('accepts card, with or without Link', () => {
    expect(isCardOnly(['card'])).toBe(true);
    expect(isCardOnly(['card', 'link'])).toBe(true);
  });

  it('rejects a session without card or with any other method', () => {
    expect(isCardOnly(['link'])).toBe(false);
    expect(isCardOnly([])).toBe(false);
    expect(isCardOnly(['card', 'klarna'])).toBe(false);
  });
});
