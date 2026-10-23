// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CancelOrderDraftPayload } from '../payloads';
import { CancelOrderCard, type CancelOrderLabels } from './cancel-order-card/CancelOrderCard';

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

function mount(node: React.ReactNode) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(node));
  return host;
}

const button = (text: string) => {
  const found = [...host.querySelectorAll('button')].find((b) => b.textContent === text);
  if (!found) throw new Error(`no button ${text}`);
  return found;
};

const DRAFT: CancelOrderDraftPayload = {
  pendingId: 'p-1',
  orderId: 'f2b1c3d4-0000-4000-8000-000000000001',
  proposalId: 'f2b1c3d4-0000-4000-8000-000000000002',
  offerTitle: 'Blue Lagoon boat trip',
  language: 'en',
  date: '2026-10-22',
  startsAtLocal: '2026-10-22T09:00',
  quantity: 2,
  paymentMode: 'online',
  paymentStatus: 'captured',
  priceMinor: 9000,
  currency: 'EUR',
  cancellationPolicy: 'Free cancellation up to 24 hours before the start, then 50 % back.',
  refundMinor: 4500,
  refundPercent: 50,
  freeUntil: '2026-10-21T07:00:00.000Z',
  freeUntilLocal: '2026-10-21T09:00',
};

const LABELS: CancelOrderLabels = {
  heading: 'Cancel this booking?',
  offer: 'Offer',
  when: 'When',
  quantity: 'People',
  dateTime: (date, local) => (local ? `${date} at ${local.slice(11)}` : date),
  refundPartial: (amount, percent) => `You get back ${amount} (${percent} %)`,
  refundFull: (amount) => `Free cancellation: you get back all ${amount}`,
  refundNone: 'Nothing is refunded under this policy',
  refundNotPaid: 'Nothing has been paid yet',
  refundDirect: 'Paid directly to the provider',
  freeUntil: (when) => `Free until ${when}`,
  policy: 'Cancellation policy',
  confirm: 'Cancel booking',
  keep: 'Keep it',
  sending: 'Cancelling…',
};

const render = (
  draft: Partial<CancelOrderDraftPayload> = {},
  state: 'open' | 'sending' = 'open',
) => {
  const onConfirm = vi.fn();
  const onKeep = vi.fn();
  mount(
    <CancelOrderCard
      draft={{ ...DRAFT, ...draft }}
      state={state}
      onConfirm={onConfirm}
      onKeep={onKeep}
      labels={LABELS}
    />,
  );
  return { onConfirm, onKeep, refund: host.querySelector('.fv-cancel-amount')?.textContent };
};

describe('CancelOrderCard', () => {
  it('shows the facts, the policy text and the partial refund', () => {
    const { refund } = render();
    expect(refund).toBe('You get back €45.00 (50 %)');
    const text = host.textContent ?? '';
    for (const fact of ['Blue Lagoon boat trip', '2026-10-22 at 09:00', 'People2']) {
      expect(text).toContain(fact);
    }
    expect(text).toContain(DRAFT.cancellationPolicy);
    // Past the cutoff: no "free until" line.
    expect(text).not.toContain('Free until');
  });

  it('shows a free cancellation with its cutoff', () => {
    const { refund } = render({ refundMinor: 9000, refundPercent: 100 });
    expect(refund).toBe('Free cancellation: you get back all €90.00');
    expect(host.textContent).toContain('Free until 2026-10-21 at 09:00');
  });

  it('says when nothing comes back, and when nothing was paid through Fetivi', () => {
    expect(render({ refundMinor: 0, refundPercent: 0 }).refund).toBe(
      'Nothing is refunded under this policy',
    );
    expect(render({ paymentMode: 'direct', paymentStatus: 'none', refundMinor: null }).refund).toBe(
      'Paid directly to the provider',
    );
    expect(render({ paymentStatus: 'none', refundMinor: null, refundPercent: null }).refund).toBe(
      'Nothing has been paid yet',
    );
  });

  it('calls back on Cancel booking and Keep it; both wait while sending', () => {
    const { onConfirm, onKeep } = render();
    act(() => button('Cancel booking').click());
    act(() => button('Keep it').click());
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onKeep).toHaveBeenCalledOnce();

    render({}, 'sending');
    expect(button('Cancel booking').disabled).toBe(true);
    expect(button('Keep it').disabled).toBe(true);
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Cancelling…');
  });
});
