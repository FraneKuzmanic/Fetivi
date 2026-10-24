// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { SpaceProvider } from '../../space';
import { TripTab } from '../TripTab';

const order = (id: string, status: string, paymentStatus = 'none') => ({
  id,
  offerId: 'o-1',
  offerTitle: `Trip ${id}`,
  status,
  paymentStatus,
  paymentMode: 'direct',
  date: '2026-10-22',
  startsAt: null,
  startsAtLocal: null,
  quantity: 2,
  priceMinor: 9000,
  currency: 'EUR',
  priceUnit: 'person',
  createdAt: '2026-10-21T10:00:00.000Z',
});

let root: Root | null = null;
let host: HTMLElement;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const EMPTY_PLAN = {
  plan: {
    checkIn: '2026-10-22',
    checkout: '2026-10-23',
    today: '2026-10-22',
    days: [{ date: '2026-10-22', items: [] }],
  },
};

/** Answers /api/orders with the replies in turn; the plan section's read gets an empty plan. */
function stubOrders(...replies: (() => Response)[]) {
  const orders = vi.fn(async () => (replies.shift() ?? replies.at(-1) ?? (() => new Response()))());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) =>
      String(input) === '/api/orders' ? orders() : json(EMPTY_PLAN),
    ),
  );
  return orders;
}

async function mount(path = '/trip', closed = false) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root?.render(
      <MemoryRouter initialEntries={[path]}>
        <SpaceProvider
          initial={{
            status: 'ready',
            space: {
              language: 'en',
              closedAt: '2026-10-24T22:00:00Z',
              closed,
              unitSlug: 's',
              keepForEvaluation: false,
            },
          }}
        >
          <TripTab />
        </SpaceProvider>
      </MemoryRouter>,
    ),
  );
}

describe('My trip → Reservations & orders', () => {
  it('says nothing is booked yet', async () => {
    stubOrders(() => json({ orders: [] }));
    await mount();
    await vi.waitFor(() => expect(host.textContent).toContain('Nothing booked yet.'));
    expect(host.querySelector('h1')?.textContent).toBe('My trip');
    expect([...host.querySelectorAll('h2')].map((h) => h.textContent)).toEqual([
      'Plan',
      'Reservations & orders',
    ]);
  });

  it('lists each Order with both statuses, read-only', async () => {
    stubOrders(() => json({ orders: [order('o2', 'pending_provider'), order('o1', 'confirmed')] }));
    await mount();
    await vi.waitFor(() => expect(host.querySelectorAll('.fv-receipt')).toHaveLength(2));
    const [first, second] = [...host.querySelectorAll('.fv-receipt')].map((r) => r.textContent);
    expect(first).toContain('Trip o2');
    expect(first).toContain('Waiting for the provider');
    expect(first).toContain('Pay the provider directly');
    expect(second).toContain('Confirmed');
    expect(host.querySelectorAll('.trip-orders button, .trip-orders input')).toHaveLength(0);
  });

  it('offers a retry when offline', async () => {
    const fetch = stubOrders(
      () => {
        throw new TypeError('offline');
      },
      () => json({ orders: [order('o1', 'confirmed')] }),
    );
    await mount();
    await vi.waitFor(() => expect(host.textContent).toContain('No connection.'));
    await act(async () => {
      [...host.querySelectorAll('button')].find((b) => b.textContent === 'Try again')?.click();
    });
    await vi.waitFor(() => expect(host.querySelectorAll('.fv-receipt')).toHaveLength(1));
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

const online = (id: string, status: string, paymentStatus: string, payBy: string | null) => ({
  ...order(id, status, paymentStatus),
  paymentMode: 'online',
  payBy,
});

/** Answers /api/orders and the checkout POST with their replies in turn. */
function stubPay(orders: (() => Response)[], checkouts: (() => Response)[] = []) {
  const calls: string[] = [];
  const next = (list: (() => Response)[]) =>
    (list.length > 1 ? list.shift() : list[0]) as () => Response;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url === '/api/orders') return next(orders)();
      if (url.endsWith('/checkout')) return next(checkouts)();
      return json(EMPTY_PLAN);
    }),
  );
  return calls;
}

const payButton = () =>
  [...host.querySelectorAll('button')].find((b) => b.textContent === 'Pay now');

describe('My trip → paying online', () => {
  it('opens the secure page once it is ready', async () => {
    const assign = vi.fn();
    vi.spyOn(window.location, 'assign').mockImplementation(assign);
    const calls = stubPay(
      [() => json({ orders: [online('o1', 'confirming', 'none', '2026-10-22T10:30:00.000Z')] })],
      [
        () => json({ state: 'preparing' }),
        () => json({ state: 'ready', url: 'https://checkout.stripe.com/x' }),
      ],
    );
    await mount();
    await vi.waitFor(() => expect(payButton()).toBeDefined());
    expect(host.textContent).toContain('Complete payment by');
    await act(async () => payButton()?.click());
    expect(host.textContent).toContain('Opening the secure payment page…');
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/x'), {
      timeout: 3000,
    });
    expect(calls.filter((c) => c === 'POST /api/orders/o1/checkout')).toHaveLength(2);
  });

  it('says when the payment window has closed', async () => {
    stubPay(
      [
        () => json({ orders: [online('o1', 'confirming', 'none', '2026-10-22T10:30:00.000Z')] }),
        () => json({ orders: [online('o1', 'expired', 'none', null)] }),
      ],
      [() => json({ state: 'closed' })],
    );
    await mount();
    await vi.waitFor(() => expect(payButton()).toBeDefined());
    await act(async () => payButton()?.click());
    await vi.waitFor(() => expect(host.textContent).toContain('This payment window has closed.'));
    expect(payButton()).toBeUndefined();
  });

  it('waits for the booking after the return from Stripe', async () => {
    const calls = stubPay([
      () => json({ orders: [online('o1', 'confirming', 'none', '2026-10-22T10:30:00.000Z')] }),
      () => json({ orders: [online('o1', 'confirmed', 'captured', null)] }),
    ]);
    await mount('/trip?checkout=o1');
    await vi.waitFor(() =>
      expect(host.textContent).toContain("Thanks! I'm confirming your booking with the provider…"),
    );
    await vi.waitFor(() => expect(host.textContent).toContain('Confirming'));
    expect(host.textContent).not.toContain('Pay now');
    await vi.waitFor(() => expect(host.textContent).toContain('Paid'), { timeout: 4000 });
    // The wait ends in the effect after the render that shows Paid.
    await vi.waitFor(() => expect(host.textContent).not.toContain("I'm confirming your booking"));
    expect(calls.filter((c) => c === 'GET /api/orders')).toHaveLength(2);
  });

  it('explains a payment that came in after the booking closed', async () => {
    stubPay([() => json({ orders: [online('o1', 'expired', 'voided', null)] })]);
    await mount('/trip?checkout=o1');
    await vi.waitFor(() =>
      expect(host.textContent).toContain('The payment came in after the booking had closed'),
    );
  });
});

const ORDER_ID = 'f2b1c3d4-0000-4000-8000-000000000001';
const card = (toolName: string, extra: Record<string, unknown>) => ({
  toolCallId: 'call-1',
  toolName,
  key: 'confirm',
  message: '',
  requestedSchema: { type: 'object', properties: {} },
  requestState: `sealed.${toolName}`,
  draft: null,
  hostMessage: null,
  cancelOrder: null,
  respondOrder: null,
  ...extra,
});
const CANCEL_DRAFT = {
  pendingId: 'p-1',
  orderId: ORDER_ID,
  proposalId: 'f2b1c3d4-0000-4000-8000-000000000002',
  offerTitle: `Trip ${ORDER_ID}`,
  language: 'en',
  date: '2026-10-22',
  startsAtLocal: null,
  quantity: 2,
  paymentMode: 'direct',
  paymentStatus: 'none',
  priceMinor: 9000,
  currency: 'EUR',
  cancellationPolicy: 'Free cancellation until 24 hours before.',
  refundMinor: null,
  refundPercent: null,
  freeUntil: null,
  freeUntilLocal: null,
};
const RESPOND_DRAFT = {
  pendingId: 'p-2',
  orderId: ORDER_ID,
  proposalId: 'f2b1c3d4-0000-4000-8000-000000000003',
  offerTitle: `Trip ${ORDER_ID}`,
  language: 'en',
  proposer: 'provider_time',
  date: '2026-10-22',
  startsAtLocal: '2026-10-22T17:30',
  quantity: 2,
  priceMinor: 9000,
  currency: 'EUR',
  previous: { date: '2026-10-22', startsAtLocal: null, priceMinor: 9000 },
  paymentMode: 'direct',
  cancellationPolicy: 'Free cancellation until 24 hours before.',
  respondBy: '2026-10-24T08:00:00.000Z',
  respondByLocal: '2026-10-24T10:00',
};

/** Answers /api/orders with the lists in turn and each action POST from its own reply list. */
function stubActions(lists: unknown[][], replies: Record<string, (() => Response)[]> = {}) {
  const calls: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/orders')
        return json({ orders: lists.length > 1 ? lists.shift() : lists[0] });
      if (url.startsWith('/api/orders/')) {
        calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        const reply = replies[url.split('/').at(-1) ?? '']?.shift();
        return reply ? reply() : new Response(null, { status: 500 });
      }
      return json(EMPTY_PLAN);
    }),
  );
  return calls;
}

const tap = (text: string) =>
  act(async () => {
    [...host.querySelectorAll('button')].find((b) => b.textContent === text)?.click();
  });
const buttons = () => [...host.querySelectorAll('.trip-orders button')].map((b) => b.textContent);
const conflict = () => new Response(JSON.stringify({ error: 'action-refused' }), { status: 409 });
const awaitingGuest = () => ({
  ...order(ORDER_ID, 'awaiting_confirmation'),
  respondBy: RESPOND_DRAFT.respondBy,
});

describe('My trip → after checkout', () => {
  it('offers Cancel on an unresolved Order only once the stay has ended', async () => {
    stubActions([[order(ORDER_ID, 'pending_provider'), order('o1', 'confirmed')]]);
    await mount('/trip', false);
    await vi.waitFor(() => expect(host.querySelectorAll('.fv-receipt')).toHaveLength(2));
    expect(buttons()).toEqual([]);
    act(() => root?.unmount());
    await mount('/trip', true);
    await vi.waitFor(() => expect(host.querySelectorAll('.fv-receipt')).toHaveLength(2));
    // The confirmed Order has no buttons: after checkout only unresolved Orders can change.
    expect(buttons()).toEqual(['Cancel booking']);
  });

  it('cancels through the card and reads the list again', async () => {
    const calls = stubActions(
      [[order(ORDER_ID, 'pending_provider')], [order(ORDER_ID, 'cancelled')]],
      {
        cancel: [() => json({ card: card('cancel_order', { cancelOrder: CANCEL_DRAFT }) })],
        answer: [() => json({ outcome: 'cancelled', order: order(ORDER_ID, 'cancelled') })],
      },
    );
    await mount('/trip', true);
    await vi.waitFor(() => expect(buttons()).toEqual(['Cancel booking']));
    await tap('Cancel booking');
    await vi.waitFor(() => expect(host.textContent).toContain('Cancel this booking?'));
    // The card never takes focus on its own.
    expect(host.querySelector('.fv-confirm')?.contains(document.activeElement)).toBe(false);
    await tap('Cancel booking');
    await vi.waitFor(() => expect(host.textContent).toContain('Cancelled'));
    expect(calls.map((c) => c.url)).toEqual([
      `/api/orders/${ORDER_ID}/cancel`,
      `/api/orders/${ORDER_ID}/answer`,
    ]);
    expect(calls[1]?.body).toEqual({
      toolName: 'cancel_order',
      requestState: 'sealed.cancel_order',
      action: 'accept',
      content: {},
    });
    expect(buttons()).toEqual([]);
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(host.querySelector('.trip-orders li')),
    );
  });

  it("answers a Provider's new terms with the card's field", async () => {
    const calls = stubActions([[awaitingGuest()], [order(ORDER_ID, 'confirmed')]], {
      respond: [
        () => json({ card: card('respond_to_order_update', { respondOrder: RESPOND_DRAFT }) }),
      ],
      answer: [() => json({ outcome: 'accepted', order: order(ORDER_ID, 'confirmed') })],
    });
    await mount('/trip', true);
    await vi.waitFor(() => expect(buttons()).toEqual(['Answer the new terms', 'Cancel booking']));
    await tap('Answer the new terms');
    await vi.waitFor(() => expect(buttons()).toContain('Accept'));
    await tap('Accept');
    await vi.waitFor(() => expect(host.textContent).toContain('Confirmed'));
    expect(calls[1]?.body).toEqual({
      toolName: 'respond_to_order_update',
      requestState: 'sealed.respond_to_order_update',
      action: 'accept',
      content: { answer: 'accept' },
    });
  });

  it('Not now answers cancel and closes the card', async () => {
    const calls = stubActions([[awaitingGuest()]], {
      respond: [
        () => json({ card: card('respond_to_order_update', { respondOrder: RESPOND_DRAFT }) }),
      ],
      answer: [() => json({ outcome: 'not-now', order: awaitingGuest() })],
    });
    await mount('/trip', true);
    await vi.waitFor(() => expect(buttons()).toContain('Answer the new terms'));
    await tap('Answer the new terms');
    await vi.waitFor(() => expect(buttons()).toContain('Not now'));
    await tap('Not now');
    await vi.waitFor(() => expect(buttons()).toEqual(['Answer the new terms', 'Cancel booking']));
    expect(calls[1]?.body).toMatchObject({ action: 'cancel' });
  });

  it('a refused action says so and shows the Order as it now stands', async () => {
    stubActions([[order(ORDER_ID, 'pending_provider')], [order(ORDER_ID, 'confirmed')]], {
      cancel: [conflict],
    });
    await mount('/trip', true);
    await vi.waitFor(() => expect(buttons()).toEqual(['Cancel booking']));
    await tap('Cancel booking');
    await vi.waitFor(() => expect(host.textContent).toContain("That didn't work."));
    expect(host.textContent).toContain('Confirmed');
    expect(buttons()).toEqual([]);
  });

  it('keeps the card when the connection drops', async () => {
    stubActions([[order(ORDER_ID, 'pending_provider')]], {
      cancel: [() => json({ card: card('cancel_order', { cancelOrder: CANCEL_DRAFT }) })],
      answer: [
        () => {
          throw new TypeError('offline');
        },
      ],
    });
    await mount('/trip', true);
    await vi.waitFor(() => expect(buttons()).toEqual(['Cancel booking']));
    await tap('Cancel booking');
    await vi.waitFor(() => expect(host.textContent).toContain('Cancel this booking?'));
    await tap('Cancel booking');
    await vi.waitFor(() => expect(host.textContent).toContain('No connection.'));
    expect(host.textContent).toContain('Cancel this booking?');
  });
});
