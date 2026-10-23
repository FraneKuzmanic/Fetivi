import { describe, expect, it } from 'vitest';
import { AVAILABILITY_MODES } from '../offers/vocabulary';
import {
  actionTarget,
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

// Written out independently of the implementation: `from action trigger mode -> to`.
// `*` = every availability mode.
const EXPECTED = `
awaiting_confirmation guest_confirm guest live -> confirming
awaiting_confirmation guest_confirm guest allotment -> confirming
awaiting_confirmation guest_confirm guest on_request -> pending_provider
awaiting_confirmation guest_confirm admin live -> confirming
awaiting_confirmation guest_confirm admin allotment -> confirming
awaiting_confirmation guest_confirm admin on_request -> pending_provider
awaiting_confirmation expire card_timer * -> expired
awaiting_confirmation expire admin * -> expired
awaiting_confirmation cancel guest * -> cancelled
awaiting_confirmation cancel admin * -> cancelled
confirming confirm adapter * -> confirmed
confirming confirm admin * -> confirmed
confirming fail adapter * -> failed
confirming fail admin * -> failed
confirming fail payment_job * -> failed
confirming expire hold_timer * -> expired
confirming expire admin * -> expired
confirming expire payment_webhook * -> expired
confirming expire payment_job * -> expired
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

const expected = new Map<string, string>();
for (const line of EXPECTED.trim().split('\n')) {
  const [lhs, to] = line.split(' -> ') as [string, string];
  const [from, action, trigger, mode] = lhs.split(' ');
  const modes = mode === '*' ? AVAILABILITY_MODES : [mode];
  for (const m of modes) expected.set(`${from} ${action} ${trigger} ${m}`, to);
}

describe('nextStatus', () => {
  it('matches the written-out table for every combination', () => {
    let edges = 0;
    for (const from of ORDER_STATUSES) {
      for (const action of ORDER_ACTIONS) {
        for (const trigger of ORDER_TRIGGERS) {
          for (const mode of AVAILABILITY_MODES) {
            const key = `${from} ${action} ${trigger} ${mode}`;
            const to = nextStatus(from, action, trigger, mode);
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
          for (const mode of AVAILABILITY_MODES) {
            expect(nextStatus(from, action, trigger, mode)).toBeNull();
          }
        }
      }
    }
  });

  it('sends the guest confirmation to the Provider only for on-request Offers', () => {
    expect(nextStatus('awaiting_confirmation', 'guest_confirm', 'guest', 'on_request')).toBe(
      'pending_provider',
    );
    expect(nextStatus('awaiting_confirmation', 'guest_confirm', 'guest', 'live')).toBe(
      'confirming',
    );
  });
});

describe('actionTarget', () => {
  it('is the target of every legal edge of the action, and null for a trigger never legal', () => {
    for (const action of ORDER_ACTIONS) {
      for (const trigger of ORDER_TRIGGERS) {
        for (const mode of AVAILABILITY_MODES) {
          const targets = new Set(
            ORDER_STATUSES.map((from) => expected.get(`${from} ${action} ${trigger} ${mode}`)),
          );
          targets.delete(undefined);
          const key = `${action} ${trigger} ${mode}`;
          expect(targets.size, key).toBeLessThanOrEqual(1);
          expect(actionTarget(action, trigger, mode), key).toBe([...targets][0] ?? null);
        }
      }
    }
  });
});

// `from action trigger -> to`, written out independently of the implementation.
const EXPECTED_PAYMENT = `
none authorize payment_webhook -> authorized
none authorize payment_job -> authorized
none authorize admin -> authorized
authorized capture payment_job -> captured
authorized capture payment_webhook -> captured
authorized void payment_job -> voided
authorized void payment_webhook -> voided
captured refund payment_job -> refund_pending
captured refund payment_webhook -> refund_pending
captured refund admin -> refund_pending
captured refund provider_link -> refund_pending
captured refund guest -> refund_pending
refund_pending refunded payment_job -> refunded
refund_pending refunded payment_webhook -> refunded
refund_pending refund_failed payment_job -> failed
refund_pending refund_failed payment_webhook -> failed
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
