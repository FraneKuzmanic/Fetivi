import { describe, expect, it } from 'vitest';
import {
  actionTarget,
  asksProvider,
  nextPaymentStatus,
  nextStatus,
  ORDER_ACTIONS,
  PAYMENT_ACTIONS,
  paymentActionTarget,
  requiredNotifications,
} from './transitions';
import {
  FINAL_ORDER_STATUSES,
  ORDER_STATUSES,
  ORDER_TRIGGERS,
  PAYMENT_STATUSES,
} from './vocabulary';

// Written out independently of the implementation: `from action trigger asks -> to`, where
// `asks` is whether the guest's confirmation still needs the Provider's yes. `*` = either.
const EXPECTED = `
awaiting_confirmation guest_confirm guest no -> confirming
awaiting_confirmation guest_confirm guest yes -> pending_provider
awaiting_confirmation guest_confirm admin no -> confirming
awaiting_confirmation guest_confirm admin yes -> pending_provider
awaiting_confirmation expire card_timer * -> expired
awaiting_confirmation expire admin * -> expired
awaiting_confirmation cancel guest * -> cancelled
awaiting_confirmation cancel admin * -> cancelled
confirming confirm adapter * -> confirmed
confirming confirm admin * -> confirmed
confirming fail adapter * -> failed
confirming fail admin * -> failed
confirming fail payment_job * -> failed
confirming fail payment_webhook * -> failed
confirming fail reconciliation * -> failed
confirming expire hold_timer * -> expired
confirming expire admin * -> expired
confirming expire payment_webhook * -> expired
confirming expire payment_job * -> expired
confirming expire reconciliation * -> expired
confirming ask_provider payment_webhook * -> pending_provider
confirming ask_provider payment_job * -> pending_provider
confirming ask_provider reconciliation * -> pending_provider
confirming ask_provider admin * -> pending_provider
pending_provider confirm provider_link * -> confirmed
pending_provider confirm admin * -> confirmed
pending_provider decline provider_link * -> declined
pending_provider decline admin * -> declined
pending_provider propose provider_link * -> awaiting_confirmation
pending_provider propose admin * -> awaiting_confirmation
pending_provider cancel guest * -> cancelled
pending_provider cancel admin * -> cancelled
confirmed cancel guest * -> cancelled
confirmed cancel provider_link * -> cancelled
confirmed cancel admin * -> cancelled
confirmed complete completion_timer * -> completed
confirmed complete admin * -> completed
`;

const ASKS = [false, true] as const;
const word = (asks: boolean) => (asks ? 'yes' : 'no');

const expected = new Map<string, string>();
for (const line of EXPECTED.trim().split('\n')) {
  const [lhs, to] = line.split(' -> ') as [string, string];
  const [from, action, trigger, asks] = lhs.split(' ');
  const values = asks === '*' ? ['no', 'yes'] : [asks];
  for (const a of values) expected.set(`${from} ${action} ${trigger} ${a}`, to);
}

describe('nextStatus', () => {
  it('matches the written-out table for every combination', () => {
    let edges = 0;
    for (const from of ORDER_STATUSES) {
      for (const action of ORDER_ACTIONS) {
        for (const trigger of ORDER_TRIGGERS) {
          for (const asks of ASKS) {
            const key = `${from} ${action} ${trigger} ${word(asks)}`;
            const to = nextStatus(from, action, trigger, asks);
            expect(to, key).toBe(expected.get(key) ?? null);
            if (to) edges++;
          }
        }
      }
    }
    expect(edges).toBe(expected.size);
  });

  it('gives final statuses no outgoing edge, admin included', () => {
    for (const from of FINAL_ORDER_STATUSES) {
      for (const action of ORDER_ACTIONS) {
        for (const trigger of ORDER_TRIGGERS) {
          for (const asks of ASKS) {
            expect(nextStatus(from, action, trigger, asks)).toBeNull();
          }
        }
      }
    }
  });

  it('sends the guest confirmation to the Provider only when the Provider still has to say yes', () => {
    expect(nextStatus('awaiting_confirmation', 'guest_confirm', 'guest', true)).toBe(
      'pending_provider',
    );
    expect(nextStatus('awaiting_confirmation', 'guest_confirm', 'guest', false)).toBe('confirming');
  });

  it('puts a paid-first Order to the Provider only from confirming, and never by the guest', () => {
    expect(nextStatus('confirming', 'ask_provider', 'payment_webhook', false)).toBe(
      'pending_provider',
    );
    expect(nextStatus('confirming', 'ask_provider', 'guest', false)).toBeNull();
    expect(
      nextStatus('awaiting_confirmation', 'ask_provider', 'payment_webhook', false),
    ).toBeNull();
  });

  it('lets reconciliation expire or fail a confirming Order, and never confirm or cancel one', () => {
    expect(nextStatus('confirming', 'fail', 'reconciliation', false)).toBe('failed');
    expect(nextStatus('confirming', 'fail', 'payment_webhook', false)).toBe('failed');
    expect(nextStatus('confirming', 'expire', 'reconciliation', false)).toBe('expired');
    for (const asks of ASKS) {
      expect(nextStatus('confirming', 'confirm', 'reconciliation', asks)).toBeNull();
      expect(
        nextStatus('awaiting_confirmation', 'guest_confirm', 'reconciliation', asks),
      ).toBeNull();
      expect(nextStatus('confirmed', 'cancel', 'reconciliation', asks)).toBeNull();
    }
  });
});

describe('actionTarget', () => {
  it('is the target of every legal edge of the action, and null for a trigger never legal', () => {
    for (const action of ORDER_ACTIONS) {
      for (const trigger of ORDER_TRIGGERS) {
        for (const asks of ASKS) {
          const targets = new Set(
            ORDER_STATUSES.map((from) =>
              expected.get(`${from} ${action} ${trigger} ${word(asks)}`),
            ),
          );
          targets.delete(undefined);
          const key = `${action} ${trigger} ${word(asks)}`;
          expect(targets.size, key).toBeLessThanOrEqual(1);
          expect(actionTarget(action, trigger, asks), key).toBe([...targets][0] ?? null);
        }
      }
    }
  });
});

describe('asksProvider', () => {
  const priced = { proposer: 'offer', priceMinor: 9000 } as const;
  const request = { proposer: 'offer', priceMinor: null } as const;

  it('asks the Provider for on-request Offers on their own terms that are not paid first', () => {
    expect(asksProvider('on_request', priced, 'direct')).toBe(true);
    expect(asksProvider('on_request', request, 'direct')).toBe(true);
    expect(asksProvider('on_request', request, 'online')).toBe(true);
  });

  it('pays a priced pay-online on-request Order first', () => {
    expect(asksProvider('on_request', priced, 'online')).toBe(false);
  });

  it('never asks again for terms the Provider or the admin proposed', () => {
    for (const proposer of ['provider_time', 'provider_price', 'admin'] as const) {
      expect(asksProvider('on_request', { proposer, priceMinor: 9000 }, 'direct')).toBe(false);
    }
  });

  it('never asks for allotment or live Offers', () => {
    expect(asksProvider('allotment', priced, 'direct')).toBe(false);
    expect(asksProvider('live', request, 'direct')).toBe(false);
  });
});

// `from action trigger -> to`, written out independently of the implementation.
const EXPECTED_PAYMENT = `
none authorize payment_webhook -> authorized
none authorize payment_job -> authorized
none authorize admin -> authorized
none authorize reconciliation -> authorized
authorized capture payment_job -> captured
authorized capture payment_webhook -> captured
authorized capture reconciliation -> captured
authorized void payment_job -> voided
authorized void payment_webhook -> voided
authorized void reconciliation -> voided
captured refund payment_job -> refund_pending
captured refund payment_webhook -> refund_pending
captured refund admin -> refund_pending
captured refund provider_link -> refund_pending
captured refund guest -> refund_pending
captured refund reconciliation -> refund_pending
refund_pending refunded payment_job -> refunded
refund_pending refunded payment_webhook -> refunded
refund_pending refunded reconciliation -> refunded
refund_pending refund_failed payment_job -> failed
refund_pending refund_failed payment_webhook -> failed
refund_pending refund_failed reconciliation -> failed
`;

const expectedPayment = new Map(
  EXPECTED_PAYMENT.trim()
    .split('\n')
    .map((line) => line.split(' -> ') as [string, string]),
);

describe('nextPaymentStatus', () => {
  it('matches the written-out table for every combination', () => {
    let edges = 0;
    for (const from of PAYMENT_STATUSES) {
      for (const action of PAYMENT_ACTIONS) {
        for (const trigger of ORDER_TRIGGERS) {
          const key = `${from} ${action} ${trigger}`;
          const to = nextPaymentStatus(from, action, trigger);
          expect(to, key).toBe(expectedPayment.get(key) ?? null);
          if (to) edges++;
        }
      }
    }
    expect(edges).toBe(expectedPayment.size);
  });

  it('never captures without an authorization and never leaves a released state', () => {
    expect(nextPaymentStatus('none', 'capture', 'payment_job')).toBeNull();
    expect(nextPaymentStatus('voided', 'capture', 'payment_webhook')).toBeNull();
    expect(nextPaymentStatus('refunded', 'refund', 'admin')).toBeNull();
    expect(nextPaymentStatus('authorized', 'capture', 'guest')).toBeNull();
  });

  it('lets reconciliation feed every payment event a webhook can', () => {
    expect(nextPaymentStatus('authorized', 'void', 'reconciliation')).toBe('voided');
    expect(nextPaymentStatus('none', 'authorize', 'reconciliation')).toBe('authorized');
    expect(nextPaymentStatus('captured', 'refund', 'reconciliation')).toBe('refund_pending');
  });
});

describe('paymentActionTarget', () => {
  it('is the target of every legal edge of the action, so a repeat reads as unchanged', () => {
    for (const action of PAYMENT_ACTIONS) {
      for (const trigger of ORDER_TRIGGERS) {
        const targets = new Set(
          PAYMENT_STATUSES.map((from) => expectedPayment.get(`${from} ${action} ${trigger}`)),
        );
        targets.delete(undefined);
        const key = `${action} ${trigger}`;
        expect(targets.size, key).toBeLessThanOrEqual(1);
        expect(paymentActionTarget(action, trigger), key).toBe([...targets][0] ?? null);
      }
    }
  });
});

describe('requiredNotifications', () => {
  it('tells the guest a pay-online checkout closed unpaid, not that the Provider was silent', () => {
    expect(requiredNotifications('confirming', 'expired', 'hold_timer', 'online')).toEqual([
      'order_checkout_expired',
    ]);
    expect(requiredNotifications('confirming', 'expired', 'payment_webhook', 'online')).toEqual([
      'order_checkout_expired',
    ]);
    expect(
      requiredNotifications('awaiting_confirmation', 'expired', 'card_timer', 'online'),
    ).toEqual(['order_expired']);
    expect(requiredNotifications('confirming', 'expired', 'hold_timer', 'direct')).toEqual([
      'order_expired',
    ]);
  });

  it('notifies the guest of a later proposal, but nobody on creation', () => {
    expect(requiredNotifications(null, 'awaiting_confirmation', 'guest')).toEqual([]);
    expect(requiredNotifications('pending_provider', 'awaiting_confirmation', 'admin')).toEqual([
      'order_new_proposal',
    ]);
  });

  it('asks the Provider when the Order waits for them', () => {
    expect(requiredNotifications('awaiting_confirmation', 'pending_provider', 'guest')).toEqual([
      'provider_request',
    ]);
    expect(
      requiredNotifications('confirming', 'pending_provider', 'payment_webhook', 'online'),
    ).toEqual(['provider_request']);
  });

  it('tells the Provider of an instant confirmation, but not of their own', () => {
    expect(requiredNotifications('confirming', 'confirmed', 'adapter')).toEqual([
      'order_confirmed',
      'provider_confirmed',
    ]);
    expect(requiredNotifications('pending_provider', 'confirmed', 'provider_link')).toEqual([
      'order_confirmed',
    ]);
  });

  it('tells the guest of every final outcome', () => {
    expect(requiredNotifications('pending_provider', 'declined', 'admin')).toEqual([
      'order_declined',
    ]);
    expect(requiredNotifications('confirming', 'expired', 'hold_timer')).toEqual(['order_expired']);
    expect(requiredNotifications('confirming', 'failed', 'adapter')).toEqual(['order_failed']);
    expect(requiredNotifications('confirmed', 'cancelled', 'guest')).toEqual(['order_cancelled']);
  });

  it("alerts the admin when the Provider can't fulfil", () => {
    expect(requiredNotifications('confirmed', 'cancelled', 'provider_link')).toEqual([
      'order_cancelled',
      'admin_provider_cancelled',
    ]);
  });

  it('notifies nobody on entering confirming or completed', () => {
    expect(requiredNotifications('awaiting_confirmation', 'confirming', 'guest')).toEqual([]);
    expect(requiredNotifications('confirmed', 'completed', 'completion_timer')).toEqual([]);
  });
});
