// @vitest-environment happy-dom
import type { InboxItem } from '@fetivi/ui/payloads';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import '../i18n';
import { InboxPart } from '../chat/render/InboxPart';
import { TripTab } from '../my-trip/TripTab';
import { SpaceProvider } from '../space';
import { AlertOffer, PushProvider } from './AlertOffer';
import { applicationServerKey } from './support';

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/129 Mobile';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15';
const PUBLIC_KEY =
  'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';

let root: Root | null = null;
let host: HTMLElement;
const restore: (() => void)[] = [];

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  for (const undo of restore.splice(0)) undo();
});

function define(target: object, key: string, value: unknown) {
  const before = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { value, configurable: true, writable: true });
  restore.push(() => {
    if (before) Object.defineProperty(target, key, before);
    else delete (target as Record<string, unknown>)[key];
  });
}

/** A browser: its user agent, push support and the guest's answer to the permission prompt. */
function browser(options: { ua: string; permission?: NotificationPermission; answer?: string }) {
  const requestPermission = vi.fn(async () => options.answer ?? 'denied');
  const subscription = {
    toJSON: () => ({
      endpoint: 'https://fcm.googleapis.com/fcm/send/x',
      keys: { p256dh: 'p', auth: 'a' },
    }),
  };
  const subscribe = vi.fn(async () => subscription);
  define(navigator, 'userAgent', options.ua);
  define(navigator, 'serviceWorker', {
    ready: Promise.resolve({ pushManager: { subscribe } }),
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  define(window, 'PushManager', class {});
  define(window, 'Notification', {
    permission: options.permission ?? 'default',
    requestPermission,
  });
  return { requestPermission, subscribe };
}

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

/** Answers /api/push with `state`, any write with 204, and records the calls. */
function server(state: { publicKey: string | null; offered: boolean; subscribed: boolean }) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url === '/api/push') return json(state);
    if (url === '/api/orders') return json({ orders: [] });
    return new Response(null, { status: 204 });
  });
  vi.stubGlobal('fetch', fetch);
  return calls;
}

async function mount(node: React.ReactNode) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(<PushProvider>{node}</PushProvider>));
}

const offerButton = () =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Alert me'));

const OPEN = { publicKey: PUBLIC_KEY, offered: false, subscribed: false };

describe('AlertOffer', () => {
  it('never shows on an iPhone, and asks the server nothing', async () => {
    browser({ ua: IPHONE });
    const calls = server(OPEN);
    await mount(<AlertOffer />);
    expect(offerButton()).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it('does not show once offered, or when notifications are blocked', async () => {
    browser({ ua: ANDROID });
    server({ ...OPEN, offered: true });
    await mount(<AlertOffer />);
    await act(async () => {});
    expect(offerButton()).toBeUndefined();
    act(() => root?.unmount());

    browser({ ua: ANDROID, permission: 'denied' });
    const calls = server(OPEN);
    await mount(<AlertOffer />);
    expect(offerButton()).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it('offers on Android without prompting; a decline spends the offer', async () => {
    const { requestPermission } = browser({ ua: ANDROID, answer: 'denied' });
    const calls = server(OPEN);
    await mount(<AlertOffer />);
    await vi.waitFor(() => expect(offerButton()).toBeDefined());
    expect(host.textContent).toContain("I'll send a notification when there's news.");
    expect(requestPermission).not.toHaveBeenCalled();

    await act(async () => offerButton()?.click());
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET /api/push',
      'POST /api/push/offer',
    ]);
    expect(offerButton()).toBeUndefined();
  });

  it('subscribes and saves on allow', async () => {
    const { subscribe } = browser({ ua: ANDROID, answer: 'granted' });
    const calls = server(OPEN);
    await mount(<AlertOffer />);
    await vi.waitFor(() => expect(offerButton()).toBeDefined());
    await act(async () => offerButton()?.click());
    expect(subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey(PUBLIC_KEY),
    });
    expect(calls.at(-1)).toEqual({
      url: '/api/push/subscription',
      method: 'POST',
      body: { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: 'p', auth: 'a' } },
    });
    expect(offerButton()).toBeUndefined();
  });

  it('decodes a VAPID key to its 65 bytes', () => {
    expect(applicationServerKey(PUBLIC_KEY)).toHaveLength(65);
  });
});

describe('My trip offer', () => {
  const order = (status: string) => ({
    id: `o-${status}`,
    offerId: 'o-1',
    offerTitle: 'Kayak',
    status,
    paymentStatus: 'none',
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

  function withOrders(orders: unknown[]) {
    browser({ ua: ANDROID });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        json(url === '/api/push' ? OPEN : url === '/api/plan' ? EMPTY_PLAN : { orders }),
      ),
    );
  }

  const EMPTY_PLAN = {
    plan: {
      checkIn: '2026-10-22',
      checkout: '2026-10-23',
      today: '2026-10-22',
      days: [{ date: '2026-10-22', items: [] }],
    },
  };

  /** My trip needs a router and a space since the plan section (Ask Fetivi) came. */
  const trip = (
    <MemoryRouter initialEntries={['/trip']}>
      <SpaceProvider
        initial={{
          status: 'ready',
          space: { language: 'en', closedAt: '2026-10-24T22:00:00Z', closed: false, unitSlug: 's' },
        }}
      >
        <TripTab />
      </SpaceProvider>
    </MemoryRouter>
  );

  it('shows while an Order is not final', async () => {
    withOrders([order('pending_provider')]);
    await mount(trip);
    await vi.waitFor(() => expect(offerButton()).toBeDefined());
  });

  it('stays away when every Order is final', async () => {
    withOrders([order('cancelled')]);
    await mount(trip);
    await vi.waitFor(() => expect(host.textContent).toContain('Kayak'));
    expect(offerButton()).toBeUndefined();
  });
});

describe('InboxPart notices', () => {
  const notice = (over: Partial<Extract<InboxItem, { kind: 'notice' }>>): InboxItem => ({
    kind: 'notice',
    notification: 'order_confirmed',
    orderId: 'o-1',
    offerTitle: 'Sunset kayak',
    date: '2027-05-04',
    startTime: '09:00',
    checkoutTime: null,
    reviewPlatform: null,
    reviewUrl: null,
    at: '2027-05-01T10:00:00Z',
    ...over,
  });
  const html = (item: InboxItem) =>
    renderToString(
      <MemoryRouter>
        <InboxPart item={item} />
      </MemoryRouter>,
    );

  it('words every shown kind, with its link', () => {
    expect(html(notice({}))).toContain('Good news: Sunset kayak on May 4, 2027 at 9:00');
    expect(html(notice({}))).toContain('href="/trip"');
    for (const notification of [
      'order_new_proposal',
      'order_cancelled',
      'order_declined',
      'order_expired',
      'order_failed',
      'order_reminder',
    ] as const) {
      expect(html(notice({ notification }))).toContain('Sunset kayak');
    }
    const arrival = html(
      notice({ notification: 'arrival_details', orderId: null, offerTitle: null, date: null }),
    );
    expect(arrival).toContain('Your arrival details are ready in the Guide');
    expect(arrival).toContain('href="/guide"');
    expect(html(notice({ notification: 'host_reply' }))).toBe('');
  });

  it('adds the review line only with a link, and the checkout time when known', () => {
    const plain = html(notice({ notification: 'checkout_reminder', checkoutTime: '10:00' }));
    expect(plain).toContain('checkout is tomorrow');
    expect(plain).toContain('Please leave by 10:00');
    expect(plain).not.toContain('review');
    const withLink = html(
      notice({
        notification: 'checkout_reminder',
        reviewPlatform: 'airbnb',
        reviewUrl: 'https://www.airbnb.com/trips',
      }),
    );
    expect(withLink).toContain('leave a review on <a href="https://www.airbnb.com/trips"');
    expect(withLink).toContain('rel="noopener noreferrer"');
    expect(withLink).toContain('>Airbnb</a>');
  });
});
