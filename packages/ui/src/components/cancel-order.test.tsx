// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CancelOrderDraftPayload } from '../payloads';
import { CancelOrderCard, type CancelOrderLabels } from './cancel-order-card/CancelOrderCard';
import { cancellationTermsText } from './cancellation-terms';
import { TERMS, TERMS_LABELS } from './fixtures';

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
  cancellation: { ...TERMS, freeWindowPassed: true },
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
  cancelFree: 'Cancelling is free.',
  freeUntil: (when) => `Free until ${when}`,
  policy: 'Cancellation policy',
  terms: TERMS_LABELS,
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
  it('shows the facts, the terms and the partial refund, never the policy text', () => {
    const { refund } = render();
    expect(refund).toBe('You get back €45.00 (50 %)');
    const text = host.textContent ?? '';
    for (const fact of ['Blue Lagoon boat trip', '2026-10-22 at 09:00', 'People2']) {
      expect(text).toContain(fact);
    }
    expect(text).toContain('Free cancellation has ended: 50 % of what you paid is refunded.');
    expect(text).not.toContain(DRAFT.cancellationPolicy);
    // Past the cutoff: no "free until" line.
    expect(text).not.toContain('Free until');
  });

  it('shows a free cancellation with its cutoff once', () => {
    const { refund } = render({ refundMinor: 9000, refundPercent: 100, cancellation: TERMS });
    expect(refund).toBe('Free cancellation: you get back all €90.00');
    const text = host.textContent ?? '';
    expect(text).toContain('Free cancellation until 2026-10-21 at 09:00.');
    expect(text).not.toContain('Free until');

    // A draft stored without terms keeps its own cutoff line.
    render({ refundMinor: 9000, refundPercent: 100, cancellation: null });
    expect(host.textContent).toContain('Free until 2026-10-21 at 09:00');
  });

  it('says when nothing comes back, and when nothing was paid through Fetivi', () => {
    expect(render({ refundMinor: 0, refundPercent: 0 }).refund).toBe(
      'Nothing is refunded under this policy',
    );
    expect(render({ paymentStatus: 'none', refundMinor: null, refundPercent: null }).refund).toBe(
      'Nothing has been paid yet',
    );
    // No terms that would contradict it, and no refund wording.
    expect(host.querySelector('.fv-cancel-policy')).toBeNull();
    expect(host.textContent).not.toMatch(/refund/i);
  });

  it('never speaks of a refund for a pay-direct order', () => {
    const direct = {
      paymentMode: 'direct',
      paymentStatus: 'none',
      refundMinor: null,
      refundPercent: null,
      freeUntil: null,
      freeUntilLocal: null,
    } as const;
    expect(render({ ...direct, cancellation: TERMS }).refund).toBe('Cancelling is free.');
    expect(host.textContent).toContain(
      'Free cancellation until 2026-10-21 at 09:00. After that, the provider may ask you to pay 50 % of the price directly to them.',
    );
    expect(host.textContent).not.toMatch(/refund/i);

    const late = render({ ...direct, cancellation: { ...TERMS, freeWindowPassed: true } });
    expect(late.refund).toBe(
      "The provider's late-cancellation terms apply: they may ask you to pay 50 % of the price directly to them.",
    );
    // Said once, not repeated as the terms.
    expect(host.querySelector('.fv-cancel-policy')).toBeNull();
    expect(host.textContent).not.toMatch(/refund/i);
  });

  it('shows no terms line for a draft stored without terms', () => {
    render({ cancellation: null });
    expect(host.querySelector('.fv-cancel-policy')).toBeNull();
    expect(host.textContent).not.toContain(DRAFT.cancellationPolicy);
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

describe('cancellationTermsText', () => {
  const text = (terms: typeof TERMS | null, mode: 'direct' | 'online', paid = true) =>
    cancellationTermsText(terms, mode, paid, TERMS_LABELS);

  it('words pay-direct terms as what the provider may ask, never a refund', () => {
    expect(text({ ...TERMS, lateChargePercent: 100 }, 'direct')).toBe(
      'Free cancellation until 2026-10-21 at 09:00. After that, the provider may ask you to pay the full price directly to them.',
    );
    expect(text({ ...TERMS, lateChargePercent: 100, freeWindowPassed: true }, 'direct')).toBe(
      "The provider's late-cancellation terms apply: they may ask you to pay the full price directly to them.",
    );
  });

  it('words pay-online terms as a refund', () => {
    expect(text(TERMS, 'online')).toBe(
      'Free cancellation until 2026-10-21 at 09:00. After that, 50 % of what you paid is refunded.',
    );
    expect(text({ ...TERMS, lateChargePercent: 100 }, 'online')).toContain(
      'After that, nothing is refunded.',
    );
    expect(text({ ...TERMS, lateChargePercent: 100, freeWindowPassed: true }, 'online')).toBe(
      'Free cancellation has ended: nothing is refunded.',
    );
  });

  it('words pay-online terms as a cost, never a refund, while nothing is paid yet', () => {
    expect(text(TERMS, 'online', false)).toBe(
      'Free cancellation until 2026-10-21 at 09:00. After that, cancelling costs 50 % of the price.',
    );
    expect(
      text({ ...TERMS, lateChargePercent: 100, freeWindowPassed: true }, 'online', false),
    ).toBe('Free cancellation has ended: cancelling costs the full price.');
    for (const terms of [TERMS, { ...TERMS, freeWindowPassed: true }]) {
      expect(text(terms, 'online', false)).not.toMatch(/refund/i);
    }
  });

  it('is free at any time with no late charge, and null without terms', () => {
    expect(text({ ...TERMS, lateChargePercent: 0, freeWindowPassed: true }, 'direct')).toBe(
      'Cancelling is free at any time.',
    );
    expect(text(null, 'online')).toBeNull();
  });
});
