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

async function mount(path = '/trip') {
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
              closed: false,
              unitSlug: 's',
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
    expect(host.textContent).not.toContain("I'm confirming your booking");
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
