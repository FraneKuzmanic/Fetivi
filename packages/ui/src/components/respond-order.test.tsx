// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RespondOrderDraftPayload } from '../payloads';
import { TERMS, TERMS_LABELS } from './fixtures';
import { RespondOrderCard, type RespondOrderLabels } from './respond-order-card/RespondOrderCard';

let root: Root | null = null;
let host: HTMLElement;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

const button = (text: string) => {
  const found = [...host.querySelectorAll('button')].find((b) => b.textContent === text);
  if (!found) throw new Error(`no button ${text}`);
  return found;
};

const DRAFT: RespondOrderDraftPayload = {
  pendingId: 'p-1',
  orderId: 'f2b1c3d4-0000-4000-8000-000000000001',
  proposalId: 'f2b1c3d4-0000-4000-8000-000000000003',
  offerTitle: 'Private boat trip',
  language: 'en',
  proposer: 'provider_time',
  date: '2026-10-22',
  startsAtLocal: '2026-10-22T17:30',
  quantity: 2,
  priceMinor: 24000,
  currency: 'EUR',
  previous: { date: '2026-10-22', startsAtLocal: null, priceMinor: 24000 },
  paymentMode: 'direct',
  cancellationPolicy: 'Free cancellation until 24 hours before.',
  respondBy: '2026-10-21T08:00:00.000Z',
  respondByLocal: '2026-10-21T10:00',
  cancellation: TERMS,
};

const LABELS: RespondOrderLabels = {
  heading: {
    provider_time: 'The provider suggests another time',
    provider_price: 'The provider named a price',
    admin: 'New terms for your booking',
  },
  offer: 'Offer',
  when: 'When',
  quantity: 'People',
  price: 'Price',
  was: 'Was',
  dateTime: (date, local) => (local ? `${date} at ${local.slice(11)}` : date),
  answerBy: (when) => `Please answer by ${when}`,
  payOnline: "You'll pay on a secure page after accepting",
  payDirect: 'Paid directly to the provider',
  policy: 'Cancellation policy',
  terms: TERMS_LABELS,
  accept: 'Accept',
  decline: 'Decline',
  notNow: 'Not now',
  declineQuestion: 'Decline and cancel this booking?',
  declineYes: 'Yes, decline',
  back: 'Back',
  sending: 'Sending…',
};

function render(draft: Partial<RespondOrderDraftPayload> = {}, state: 'open' | 'sending' = 'open') {
  const onAnswer = vi.fn();
  const onNotNow = vi.fn();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root?.render(
      <RespondOrderCard
        draft={{ ...DRAFT, ...draft }}
        state={state}
        onAnswer={onAnswer}
        onNotNow={onNotNow}
        labels={LABELS}
      />,
    ),
  );
  return { onAnswer, onNotNow };
}

describe('RespondOrderCard', () => {
  it('shows the new time with the old one struck through, the deadline and the payment', () => {
    render();
    expect(host.querySelector('h3')?.textContent).toBe('The provider suggests another time');
    expect(host.querySelector('del')?.textContent).toBe('Was 2026-10-22');
    expect(host.querySelector('ins')?.textContent).toBe('2026-10-22 at 17:30');
    const text = host.textContent ?? '';
    expect(text).toContain('Please answer by 2026-10-21 at 10:00');
    expect(text).toContain('Paid directly to the provider');
    expect(text).toContain('€240.00');
    // The price did not change: nothing struck through on it.
    expect(host.querySelectorAll('del')).toHaveLength(1);
  });

  it('shows a named price against none before, with the online payment line', () => {
    render({
      proposer: 'provider_price',
      startsAtLocal: null,
      priceMinor: 12050,
      previous: { date: '2026-10-22', startsAtLocal: null, priceMinor: null },
      paymentMode: 'online',
    });
    expect(host.querySelector('h3')?.textContent).toBe('The provider named a price');
    expect(host.querySelector('del')).toBeNull();
    expect(host.textContent).toContain('€120.50');
    expect(host.textContent).toContain("You'll pay on a secure page after accepting");
    // Nothing is paid yet: the terms speak of a cost, never a refund.
    expect(host.textContent).toContain('After that, cancelling costs 50 % of the price.');
    expect(host.textContent).not.toMatch(/refund/i);
  });

  it('shows the terms for the new start instead of the policy text', () => {
    render();
    const text = host.textContent ?? '';
    expect(text).toContain(
      'Free cancellation until 2026-10-21 at 09:00. After that, the provider may ask you to pay 50 % of the price directly to them.',
    );
    expect(text).not.toContain(DRAFT.cancellationPolicy);
    expect(text).not.toMatch(/refund/i);
    render({ cancellation: null });
    expect(host.querySelector('.fv-cancel-policy')).toBeNull();
  });

  it('accepts at once, declines only after a second tap, and Not now answers nothing', () => {
    const { onAnswer, onNotNow } = render();
    act(() => button('Accept').click());
    expect(onAnswer).toHaveBeenLastCalledWith('accept');
    act(() => button('Not now').click());
    expect(onNotNow).toHaveBeenCalledOnce();

    act(() => button('Decline').click());
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('Decline and cancel this booking?');
    act(() => button('Back').click());
    act(() => button('Decline').click());
    act(() => button('Yes, decline').click());
    expect(onAnswer).toHaveBeenLastCalledWith('decline');
  });

  it('waits while sending', () => {
    render({}, 'sending');
    expect(button('Accept').disabled).toBe(true);
    expect(button('Not now').disabled).toBe(true);
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Sending…');
  });
});
