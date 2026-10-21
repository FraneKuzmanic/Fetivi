// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import '../../i18n';
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

function stubOrders(...replies: (() => Response)[]) {
  const fetch = vi.fn(async () => (replies.shift() ?? replies.at(-1) ?? (() => new Response()))());
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

async function mount() {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(<TripTab />));
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
