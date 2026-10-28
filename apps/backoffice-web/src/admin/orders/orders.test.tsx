// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AdminOrder, AdminOrderRow } from '../../api';
import { formatMoment } from '../../forms/datetime';
import { ConfirmProvider } from '../../shell/ConfirmDialog';
import { WithPageTitle } from '../../shell/testing';
import { OrderPage } from './OrderPage';
import { OrdersPage } from './OrdersPage';

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

function stubApi(
  order: AdminOrder,
  list: () => { orders: AdminOrderRow[]; total: number } = () => ({ orders: [], total: 0 }),
) {
  calls = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.startsWith('/api/admin/orders?')) return json(list());
    if (url.endsWith('/cancel')) return json(CANCELLED);
    if (url.endsWith('/refund')) {
      return json({ ...order, canRefund: false, refundAmountMinor: 2000 });
    }
    return json(order);
  });
}

function Probe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

async function mount(path: string) {
  el = document.createElement('div');
  document.body.append(el);
  root = createRoot(el);
  await act(async () => {
    root?.render(
      <ConfirmProvider>
        <WithPageTitle>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route
                path="/admin/orders"
                element={
                  <>
                    <OrdersPage />
                    <Probe />
                  </>
                }
              />
              <Route path="/admin/orders/:id" element={<OrderPage />} />
            </Routes>
          </MemoryRouter>
        </WithPageTitle>
      </ConfirmProvider>,
    );
  });
}

const button = (name: string) =>
  [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(name));

const dialog = () => document.querySelector<HTMLDialogElement>('dialog.confirm-dialog');

/** Clicks a button of the confirm dialog, by its exact name. */
async function confirmWith(name: string) {
  const target = [...(dialog()?.querySelectorAll('button') ?? [])].find(
    (b) => b.textContent?.trim() === name,
  );
  if (!target) throw new Error(`no dialog button ${name}`);
  await act(async () => target.click());
}

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
    expect(el.querySelector('.crumbs')?.textContent).toBe('Orders');
    expect([...el.querySelectorAll('.record-chips .chip')].map((c) => c.textContent)).toEqual([
      'Confirmed',
      'Paid',
    ]);
    const text = el.textContent ?? '';
    for (const fact of [
      'Blue Lagoon boat trip',
      'Adriatic Boats',
      `When${formatMoment(ORDER.startsAt ?? '')}`,
      'TermsAs offered',
      'Free until 24 h before the start, then 30 % back.',
      'Policy refund now€50.00',
    ]) {
      expect(text).toContain(fact);
    }
    expect(el.querySelector('[aria-labelledby="order-facts"]')?.textContent).toContain(
      "Any later refund is made in the Provider's Stripe dashboard.",
    );
    const rows = [...el.querySelectorAll('.events-table tbody tr')];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain(formatMoment(ORDER.events[0]?.at ?? ''));
    expect(rows[1]?.textContent).toContain('Confirming → Confirmed');
    expect(rows[1]?.textContent).toContain('Card held → Paid');
    expect(rows[1]?.textContent).toContain('Payment');
    expect(button('Refund')).toBeUndefined();
  });

  it('names who changed the terms after the offer', async () => {
    stubApi({ ...ORDER, version: 2, proposer: 'provider_time' });
    await mount(`/admin/orders/${ID}`);
    expect(el.textContent).toContain('TermsChanged by the Provider (new time) (version 2)');
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
    expect(text).toContain("Any later refund is made in the host's Stripe dashboard.");
    expect(text).not.toContain('Provider');
  });

  it('cancels with the override in cents and the note, once confirmed', async () => {
    stubApi(ORDER);
    await mount(`/admin/orders/${ID}`);
    const amount = el.querySelector<HTMLInputElement>('input[type="number"]');
    const note = el.querySelector<HTMLTextAreaElement>('textarea');
    if (!amount || !note) throw new Error('no form');
    await type(amount, '12.34');
    await type(note, 'goodwill');

    await act(async () => button('Cancel order')?.click());
    expect(dialog()?.querySelector('h2')?.textContent).toBe('Cancel this order?');
    expect(dialog()?.textContent).toContain(
      'The guest gets €12.34 back. The guest and the Provider are told. This cannot be undone.',
    );
    await confirmWith('Cancel');
    expect(dialog()).toBeNull();
    expect(calls.some((c) => c.url.endsWith('/cancel'))).toBe(false);

    await act(async () => button('Cancel order')?.click());
    await confirmWith('Cancel and refund €12.34');
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
    await mount(`/admin/orders/${ID}`);
    expect(el.querySelector('input[type="number"]')).toBeNull();
    expect(el.textContent).toContain('Nothing is captured through Fetivi');
    await act(async () => button('Cancel order')?.click());
    expect(dialog()?.textContent).not.toContain('back.');
    await confirmWith('Cancel order');
    expect(calls.at(-1)).toMatchObject({ url: `/api/admin/orders/${ID}/cancel`, body: {} });
  });

  it('refunds a released Order once confirmed', async () => {
    stubApi({ ...ORDER, status: 'cancelled', canCancel: false, canRefund: true });
    await mount(`/admin/orders/${ID}`);
    expect(el.textContent).toContain(
      'The guest paid €50.00. You can refund part or all of it once',
    );
    const amount = el.querySelector<HTMLInputElement>('input[type="number"]');
    if (!amount) throw new Error('no amount');
    await type(amount, '20');
    await act(async () => button('Refund')?.click());
    expect(dialog()?.querySelector('h2')?.textContent).toBe('Refund €20.00 to the guest?');
    await confirmWith('Refund €20.00');
    expect(calls.at(-1)).toEqual({
      url: `/api/admin/orders/${ID}/refund`,
      method: 'POST',
      body: { refundMinor: 2000 },
    });
    expect(el.textContent).toContain('Refund decided€20.00');
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
    await mount(`/admin/orders/${ID}`);
    expect(el.querySelector('.chip.fail')?.textContent).toBe('Answer overdue');
    expect(el.textContent).toContain(
      `The answer is due ${formatMoment(PENDING.responseDueAt ?? '')}.`,
    );
    expect(el.textContent).toContain('TermsAs offered');
    expect(button('Accept')?.disabled).toBe(true);
    const note = el.querySelector<HTMLTextAreaElement>('textarea');
    if (!note) throw new Error('no note');
    await type(note, 'Phoned: they can do it');
    await act(async () => button('Accept')?.click());
    expect(dialog()?.querySelector('h2')?.textContent).toBe('Record that the Provider accepted?');
    await confirmWith('Confirm order');
    expect(calls.at(-1)).toEqual({
      url: `/api/admin/orders/${ID}/accept`,
      method: 'POST',
      body: { proposalId: PENDING.proposalId, note: 'Phoned: they can do it' },
    });
  });

  it('sends new terms with the time and the price in cents', async () => {
    stubApi(PENDING);
    await mount(`/admin/orders/${ID}`);
    const note = el.querySelector<HTMLTextAreaElement>('textarea');
    const timeInput = el.querySelector<HTMLInputElement>('.picker.time input');
    const price = el.querySelectorAll<HTMLInputElement>('input[type="number"]')[0];
    if (!note || !timeInput || !price) throw new Error('no form');
    await type(note, 'Phoned: 18:00 instead');
    await type(timeInput, '18:00');
    await type(price, '120.5');
    await act(async () => button('Send new terms')?.click());
    await confirmWith('Send new terms');
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

  it('records a phoned decline once confirmed', async () => {
    stubApi(PENDING);
    await mount(`/admin/orders/${ID}`);
    const note = el.querySelector<HTMLTextAreaElement>('textarea');
    if (!note) throw new Error('no note');
    await type(note, 'Phoned: fully booked');
    await act(async () => button('Decline')?.click());
    expect(dialog()?.querySelector('h2')?.textContent).toBe('Record that the Provider declined?');
    await confirmWith('Decline order');
    expect(calls.at(-1)).toEqual({
      url: `/api/admin/orders/${ID}/decline`,
      method: 'POST',
      body: { proposalId: PENDING.proposalId, note: 'Phoned: fully booked' },
    });
  });

  it('formats a date-only When and keeps a new date within the stay', async () => {
    stubApi({ ...PENDING, startsAt: null });
    await mount(`/admin/orders/${ID}`);
    expect(el.textContent).not.toContain('2026-10-25');
    expect(el.textContent).toContain('When25.10.2026');
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

const ROW: AdminOrderRow = {
  id: ID,
  createdAt: '2026-10-20T10:00:00.000Z',
  offerTitle: 'Blue Lagoon boat trip',
  providerName: null,
  hostEmail: 'host@example.com',
  propertyName: 'Villa Mare',
  date: '2026-10-25',
  startsAt: null,
  quantity: 2,
  priceMinor: 5000,
  currency: 'EUR',
  status: 'pending_provider',
  paymentStatus: 'captured',
  needsAction: true,
};

/** Waits out the search box's pause before it asks again. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 300)));
const location = () => el.querySelector('[data-testid="location"]')?.textContent;
const listCalls = () =>
  calls.filter((c) => c.url.startsWith('/api/admin/orders?')).map((c) => c.url);

describe('OrdersPage', () => {
  it('lists the open Orders as rows that open the Order', async () => {
    stubApi(ORDER, () => ({ orders: [ROW, { ...ROW, id: 'o2', needsAction: false }], total: 2 }));
    await mount('/admin/orders');
    expect(listCalls()).toEqual(['/api/admin/orders?view=active&offset=0']);
    const tabs = [...el.querySelectorAll('[role="tab"]')];
    expect(tabs.map((t) => t.textContent)).toEqual(['Needs you', 'Open', 'Done']);
    expect(el.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Open');
    expect(el.querySelector('.toolbar-note')?.textContent).toBe('2 orders');
    const rows = [...el.querySelectorAll('.data-table tbody tr')];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.querySelector('a')?.getAttribute('href')).toBe(`/admin/orders/${ID}`);
    expect(rows[0]?.textContent).toContain('host@example.com (host) · Villa Mare');
    expect(rows[0]?.textContent).toContain('25.10.2026');
    expect(rows[0]?.textContent).toContain('Needs you');
    expect(rows[0]?.textContent).toContain('Paid');
    expect(rows[0]?.textContent).toContain('€50.00');
    expect(rows[1]?.textContent).not.toContain('Needs you');
    expect(el.querySelector('.pager')).toBeNull();
  });

  it('keeps the tab in the address and lists that view', async () => {
    stubApi(ORDER);
    await mount('/admin/orders?view=done');
    expect(listCalls()).toEqual(['/api/admin/orders?view=done&offset=0']);
    expect(el.querySelector('.empty-title')?.textContent).toBe('No finished orders yet');
    await act(async () => button('Needs you')?.click());
    expect(location()).toBe('/admin/orders?view=needs_action');
    expect(listCalls().at(-1)).toBe('/api/admin/orders?view=needs_action&offset=0');
    expect(el.querySelector('.empty-title')?.textContent).toBe('All caught up');
    await act(async () => button('Open')?.click());
    expect(location()).toBe('/admin/orders');
  });

  it('searches once typing settles and clears a search that found nothing', async () => {
    stubApi(ORDER);
    await mount('/admin/orders');
    const search = el.querySelector<HTMLInputElement>('input[type="search"]');
    if (!search) throw new Error('no search');
    expect(el.querySelector(`label[for="${search.id}"]`)?.textContent).toBe('Search orders');
    await type(search, 'lagoon');
    await settle();
    expect(listCalls().at(-1)).toBe('/api/admin/orders?view=active&offset=0&q=lagoon');
    expect(el.querySelector('.empty-title')?.textContent).toBe('No orders match “lagoon”');
    await act(async () => button('Clear search')?.click());
    await settle();
    expect(search.value).toBe('');
    expect(listCalls().at(-1)).toBe('/api/admin/orders?view=active&offset=0');
    expect(el.querySelector('.empty-title')?.textContent).toBe('No open orders');
  });

  it('pages through more than 50 Orders', async () => {
    stubApi(ORDER, () => ({ orders: [ROW], total: 120 }));
    await mount('/admin/orders');
    expect(el.querySelector('.pager')?.textContent).toContain('1–50 of 120');
    await act(async () => button('Next')?.click());
    expect(listCalls().at(-1)).toBe('/api/admin/orders?view=active&offset=50');
    expect(el.querySelector('.pager')?.textContent).toContain('51–100 of 120');
  });
});
