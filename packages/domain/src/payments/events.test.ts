import { describe, expect, it } from 'vitest';
import { parseStripeEvent } from './events';

const ATTEMPT = '0c6f1d7e-3b1a-4f7e-9a51-2a3c4d5e6f70';

const event = (type: string, object: Record<string, unknown>, account = 'acct_1') => ({
  id: 'evt_1',
  type,
  account,
  data: { object },
});

describe('parseStripeEvent', () => {
  it('maps a completed manual-capture session (payment_status unpaid) to completed', () => {
    const parsed = parseStripeEvent(
      event('checkout.session.completed', {
        id: 'cs_1',
        status: 'complete',
        payment_status: 'unpaid',
        client_reference_id: ATTEMPT,
        payment_intent: 'pi_1',
      }),
    );
    expect(parsed).toEqual({
      kind: 'completed',
      eventId: 'evt_1',
      account: 'acct_1',
      attemptId: ATTEMPT,
      paymentIntentId: 'pi_1',
      sessionId: 'cs_1',
    });
  });

  it('ignores a session that is not complete or names no attempt', () => {
    const open = { status: 'open', client_reference_id: ATTEMPT, payment_intent: 'pi_1' };
    expect(parseStripeEvent(event('checkout.session.completed', open))).toEqual({
      kind: 'ignored',
    });
    const anonymous = { status: 'complete', payment_intent: 'pi_1' };
    expect(parseStripeEvent(event('checkout.session.completed', anonymous))).toEqual({
      kind: 'ignored',
    });
  });

  it('maps an expired session', () => {
    expect(
      parseStripeEvent(
        event('checkout.session.expired', { status: 'expired', client_reference_id: ATTEMPT }),
      ),
    ).toMatchObject({ kind: 'session_expired', attemptId: ATTEMPT });
  });

  it('maps the intent events by their metadata attempt id', () => {
    const object = { id: 'pi_1', metadata: { fetivi_attempt_id: ATTEMPT } };
    const kinds = [
      ['payment_intent.amount_capturable_updated', 'completed'],
      ['payment_intent.succeeded', 'captured'],
      ['payment_intent.canceled', 'voided'],
    ] as const;
    for (const [type, kind] of kinds) {
      expect(parseStripeEvent(event(type, object))).toEqual({
        kind,
        eventId: 'evt_1',
        account: 'acct_1',
        attemptId: ATTEMPT,
        paymentIntentId: 'pi_1',
        // An intent event names no session.
        ...(kind === 'completed' ? { sessionId: null } : {}),
      });
    }
  });

  it('maps refunds by payment intent, a charge only once fully refunded', () => {
    expect(
      parseStripeEvent(event('charge.refunded', { refunded: true, payment_intent: 'pi_1' })),
    ).toMatchObject({ kind: 'refunded', paymentIntentId: 'pi_1', attemptId: null });
    expect(
      parseStripeEvent(event('charge.refunded', { refunded: false, payment_intent: 'pi_1' })),
    ).toEqual({ kind: 'ignored' });
    expect(
      parseStripeEvent(event('refund.failed', { status: 'failed', payment_intent: 'pi_1' })),
    ).toMatchObject({ kind: 'refund_failed', paymentIntentId: 'pi_1' });
  });

  it('ignores other types and malformed events', () => {
    expect(parseStripeEvent(event('customer.created', { id: 'cus_1' }))).toEqual({
      kind: 'ignored',
    });
    expect(parseStripeEvent({ nope: true })).toEqual({ kind: 'ignored' });
  });

  it('keeps a missing account as null', () => {
    const { account: _, ...platform } = event('payment_intent.succeeded', { id: 'pi_1' });
    expect(parseStripeEvent(platform)).toMatchObject({ kind: 'captured', account: null });
  });
});
