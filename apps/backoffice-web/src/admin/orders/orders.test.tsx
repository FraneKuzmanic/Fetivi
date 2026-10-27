// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AdminOrder } from '../../api';
import { OrderLookupPage } from './OrderLookupPage';
import { OrderPage } from './OrderPage';

const ID = '0b3f1c2d-aaaa-4bbb-8ccc-123456789abc';

const ORDER: AdminOrder = {
  id: ID,
  status: 'confirmed',
  paymentStatus: 'captured',
  paymentMode: 'online',
  availabilityMode: 'allotment',
  offerTitle: 'Blue Lagoon boat trip',
  providerName: 'Adriatic Boats',
  hostEmail: null,
  date: '2026-10-25',
  startsAt: '2026-10-25T07:00:00.000Z',
  quantity: 2,
  priceMinor: 5000,
  currency: 'EUR',
  cancellationPolicy: 'Free cancellation up to 24 hours before the start.',
  freeCancelHoursBefore: 24,
  refundPercentAfter: 30,
  policyRefundMinor: 5000,
  paidAmountMinor: 5000,
  refundAmountMinor: null,
  proposalId: '1c2d3e4f-bbbb-4ccc-8ddd-123456789abc',
  proposer: 'offer',
  version: 1,
  orderKind: 'booking',
  responseDueAt: null,
  windowMissed: false,
  canAnswer: false,
  stayFrom: '2026-10-24',
  stayTo: '2026-10-28',
  zone: 'Europe/Zagreb',
  canCancel: true,
  canRefund: false,
  events: [
    {
      id: 1,
      at: '2026-10-20T10:00:00.000Z',
      from: null,
      to: 'confirming',
      fromPayment: null,
      toPayment: 'none',
      trigger: 'guest',
      note: null,
      actorEmail: null,
    },
    {
      id: 2,
      at: '2026-10-20T10:05:00.000Z',
      from: 'confirming',
      to: 'confirmed',
      fromPayment: 'authorized',
      toPayment: 'captured',
      trigger: 'payment_job',
      note: null,
      actorEmail: null,
    },
  ],
};

const CANCELLED: AdminOrder = {
  ...ORDER,
  status: 'cancelled',
  paymentStatus: 'refund_pending',
  refundAmountMinor: 1234,
  canCancel: false,
  events: [
    ...ORDER.events,
    {
      id: 3,
      at: '2026-10-21T09:00:00.000Z',
      from: 'confirmed',
      to: 'cancelled',
      fromPayment: 'captured',
      toPayment: 'captured',
      trigger: 'admin',
      note: 'refund override: 1234 of 5000 EUR; goodwill',
      actorEmail: 'admin@example.test',
    },
  ],
};

let root: Root | null = null;
let el: HTMLElement;
let calls: { url: string; method: string; body: unknown }[] = [];

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function stubApi(order: AdminOrder) {
  calls = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.endsWith('/cancel')) return json(CANCELLED);
    return json(order);
  });
}

async function mount(path: string) {
  el = document.createElement('div');
  document.body.append(el);
  root = createRoot(el);
  await act(async () => {
    root?.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/orders" element={<OrderLookupPage />} />
          <Route path="/admin/orders/:id" element={<OrderPage />} />
        </Routes>
      </MemoryRouter>,
    );
  });
}

const button = (name: string) =>
  [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(name));

/** Types like a user: React listens to the native input event. */
const type = (input: HTMLInputElement | HTMLTextAreaElement, value: string) =>
  act(() => {
    const proto = Object.getPrototypeOf(input);
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

describe('OrderPage', () => {
  it('shows the Order, its rules, the policy refund and the history', async () => {
    stubApi(ORDER);
    await mount(`/admin/orders/${ID}`);
    expect(calls[0]).toMatchObject({ url: `/api/admin/orders/${ID}`, method: 'GET' });
    const text = el.textContent ?? '';
    for (const fact of [
      'Blue Lagoon boat trip',
      'Confirmed',
      'Captured',
      'Adriatic Boats',
      'Free until 24 h before the start, then 30 % back.',
      'Policy refund now€50.00',
      "Further refunds are made in the Provider's Stripe dashboard.",
    ]) {
      expect(text).toContain(fact);
    }
    const rows = [...el.querySelectorAll('.events-table tbody tr')];
    expect(rows).toHaveLength(2);
    expect(rows[1]?.textContent).toContain('Confirming → Confirmed');
    expect(rows[1]?.textContent).toContain('Authorized → Captured');
    expect(button('Refund')).toBeUndefined();
  });

  it("names the host as the one paid on a host's own service", async () => {
    stubApi({
      ...ORDER,
      status: 'pending_provider',
      providerName: null,
      hostEmail: 'host@example.com',
      paymentMode: 'direct',
    });
    await mount(`/admin/orders/${ID}`);
    const text = el.textContent ?? '';
    expect(text).toContain('Hosthost@example.com (own service)');
    expect(text).toContain('Waiting for the host');
    expect(text).toContain('Paid to the host directly');
    expect(text).toContain("Further refunds are made in the host's Stripe dashboard.");
    expect(text).not.toContain('Provider');
  });

  it('cancels with the override in cents and the note', async () => {
    stubApi(ORDER);
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    await mount(`/admin/orders/${ID}`);
    const amount = el.querySelector<HTMLInputElement>('input[type="number"]');
    const note = el.querySelector<HTMLTextAreaElement>('textarea');
    if (!amount || !note) throw new Error('no form');
    await type(amount, '12.34');
    await type(note, 'goodwill');
    await act(async () => button('Cancel order')?.click());
    expect(confirm).toHaveBeenCalledWith(
      'Cancel this Order and refund €12.34? The guest and the Provider are told.',
    );
    expect(calls.at(-1)).toEqual({
      url: `/api/admin/orders/${ID}/cancel`,
      method: 'POST',
      body: { refundMinor: 1234, note: 'goodwill' },
    });
    expect(el.textContent).toContain('Refund decided€12.34');
    expect(el.textContent).toContain('refund override: 1234 of 5000 EUR; goodwill');
    expect(button('Cancel order')).toBeUndefined();
  });

  it('cancels a pay-direct Order without an amount field', async () => {
    stubApi({
      ...ORDER,
      paymentMode: 'direct',
      paymentStatus: 'none',
      paidAmountMinor: null,
      policyRefundMinor: null,
    });
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    await mount(`/admin/orders/${ID}`);
    expect(el.querySelector('input[type="number"]')).toBeNull();
    await act(async () => button('Cancel order')?.click());
    expect(calls.at(-1)?.body).toEqual({});
  });
});

const PENDING: AdminOrder = {
  ...ORDER,
  status: 'pending_provider',
  paymentStatus: 'none',
  paymentMode: 'direct',
  availabilityMode: 'on_request',
  paidAmountMinor: null,
  policyRefundMinor: null,
  responseDueAt: '2026-10-20T10:30:00.000Z',
  windowMissed: true,
  canAnswer: true,
};

describe("OrderPage, the Provider's answer", () => {
  it('records a phoned accept with the note, once the note is written', async () => {
    stubApi(PENDING);
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
    await mount(`/admin/orders/${ID}`);
    expect(el.textContent).toContain('Window missed');
    expect(el.textContent).toContain('Version 1, from the Offer');
    expect(button('Accept')?.disabled).toBe(true);
    const note = el.querySelector<HTMLTextAreaElement>('textarea');
    if (!note) throw new Error('no note');
    await type(note, 'Phoned: they can do it');
    await act(async () => button('Accept')?.click());
    expect(calls.at(-1)).toEqual({
      url: `/api/admin/orders/${ID}/accept`,
      method: 'POST',
      body: { proposalId: PENDING.proposalId, note: 'Phoned: they can do it' },
    });
  });

  it('sends new terms with the time and the price in cents', async () => {
    stubApi(PENDING);
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
    await mount(`/admin/orders/${ID}`);
    const note = el.querySelector<HTMLTextAreaElement>('textarea');
    const timeInput = el.querySelector<HTMLInputElement>('.picker.time input');
    const price = el.querySelectorAll<HTMLInputElement>('input[type="number"]')[0];
    if (!note || !timeInput || !price) throw new Error('no form');
    await type(note, 'Phoned: 18:00 instead');
    await type(timeInput, '18:00');
    await type(price, '120.5');
    await act(async () => button('Send new terms')?.click());
    expect(calls.at(-1)).toEqual({
      url: `/api/admin/orders/${ID}/propose`,
      method: 'POST',
      body: {
        proposalId: PENDING.proposalId,
        note: 'Phoned: 18:00 instead',
        date: PENDING.date,
        time: '18:00',
        priceMinor: 12050,
      },
    });
  });

  it('formats a date-only When and keeps a new date within the stay', async () => {
    stubApi({ ...PENDING, startsAt: null });
    await mount(`/admin/orders/${ID}`);
    expect(el.textContent).not.toContain('2026-10-25');
    const calendar = el.querySelector<HTMLButtonElement>('.picker.date .picker-button');
    await act(async () => calendar?.click());
    const day = (iso: string) => el.querySelector<HTMLButtonElement>(`[data-day="${iso}"]`);
    expect(day(PENDING.stayFrom)?.disabled).toBe(false);
    expect(day(PENDING.stayTo)?.disabled).toBe(false);
    expect(day('2026-10-23')?.disabled).toBe(true);
    expect(day('2026-10-29')?.disabled).toBe(true);
  });

  it('has no plain Accept for a request-kind Offer', async () => {
    stubApi({ ...PENDING, orderKind: 'request', priceMinor: null });
    await mount(`/admin/orders/${ID}`);
    expect(button('Accept')).toBeUndefined();
    expect(button('Decline')).toBeDefined();
  });
});

describe('OrderLookupPage', () => {
  it('opens an Order by its id and refuses a partial one', async () => {
    stubApi(ORDER);
    await mount('/admin/orders');
    const input = el.querySelector<HTMLInputElement>('input');
    if (!input) throw new Error('no field');
    await type(input, ID.slice(0, 8));
    await act(async () => button('Open')?.click());
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('full Order id');
    await type(input, ID.toUpperCase());
    await act(async () => button('Open')?.click());
    expect(calls.at(-1)).toMatchObject({ url: `/api/admin/orders/${ID}`, method: 'GET' });
  });
});
