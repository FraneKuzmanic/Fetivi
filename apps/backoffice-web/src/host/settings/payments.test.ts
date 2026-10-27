import { describe, expect, it } from 'vitest';
import { paymentsState } from './PaymentsPage';

const status = (stripeConnected: boolean, stripeCardPayments: string | null) =>
  ({ stripeConnected, stripeCardPayments, stripeCheckedAt: null }) as Parameters<
    typeof paymentsState
  >[0];

describe('paymentsState', () => {
  it('folds Stripe capability states into what the host acts on', () => {
    expect(paymentsState(status(false, null))).toBe('not_connected');
    expect(paymentsState(status(true, null))).toBe('action_needed');
    expect(paymentsState(status(true, 'restricted'))).toBe('action_needed');
    expect(paymentsState(status(true, 'unsupported'))).toBe('action_needed');
    expect(paymentsState(status(true, 'pending'))).toBe('verifying');
    expect(paymentsState(status(true, 'active'))).toBe('connected');
  });
});
