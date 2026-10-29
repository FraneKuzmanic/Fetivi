// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import type { HostMessage, HostOrder, Me } from '../../api';
import { InboxPage } from './InboxPage';

const URGENT: HostMessage = {
  id: 'h1',
  unitName: 'Apartment 1',
  propertyName: 'Villa Mare',
  checkIn: '2026-10-24',
  checkout: '2026-10-27',
  bookerName: 'Anna Schmidt',
  guestLanguage: 'de',
  hostLanguage: 'en',
  reason: 'problem',
  urgency: 'urgent',
  text: 'Kein warmes Wasser in der Dusche.',
  translation: 'No hot water in the shower.',
  translationState: 'done',
  sentAt: '2026-10-25T08:05:00.000Z',
  readAt: null,
  reply: null,
};

const READ: HostMessage = {
  ...URGENT,
  id: 'h2',
  urgency: 'normal',
  reason: 'property_question',
  text: 'Is there a hair dryer?',
  translation: null,
  translationState: 'not_needed',
  guestLanguage: 'en',
  readAt: '2026-10-24T10:00:00.000Z',
  reply: {
    text: 'Yes, in the bathroom drawer.',
    repliedAt: '2026-10-24T10:05:00.000Z',
    translationState: 'not_needed',
    deliveredAt: '2026-10-24T10:05:00.000Z',
  },
};

const HOST: Me = {
  account: {
    id: 'a1',
    email: 'host@example.test',
    role: 'host',
    language: 'en',
    languageChosen: false,
  },
  actingAs: null,
};

let root: Root | null = null;
let host: HTMLElement;
let calls: { url: string; method: string; body: unknown }[] = [];

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  orders = [];
  ordersWaiting = 0;
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const ASKED: HostOrder = {
  orderId: 'o1',
  proposalId: 'p1',
  offerTitle: 'Airport transfer',
  date: '2026-10-26',
  startTime: '14:30',
  quantity: 3,
  priceUnit: 'group',
  guest: { name: 'Ana Horvat', phone: '+385 91 000 0000' },
  status: 'pending_provider',
  final: false,
  acknowledgedAt: null,
  actions: ['accept', 'suggest_time', 'decline'],
  priceMinor: 13500,
  currency: 'EUR',
  respondBy: '2026-10-25T12:00',
  stayFrom: '2026-10-24',
  stayTo: '2026-10-30',
  needsPrice: false,
  guestNote: null,
  offerId: 'f1',
  createdAt: '2026-10-25T08:00:00.000Z',
  waiting: true,
};

let orders: HostOrder[] = [];
let ordersWaiting = 0;
let action: () => Response = () => json({ error: 'not-found' }, 404);

function stubApi(messages: HostMessage[], reply?: () => Response) {
  calls = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url === '/api/auth/me') return json(HOST);
    if (url === '/api/host/inbox') return json({ messages, unread: 1, orders, ordersWaiting });
    if (url.endsWith('/actions')) return action();
    if (url.endsWith('/read')) return new Response(null, { status: 204 });
    if (url.endsWith('/reply') && reply) return reply();
    return json({ error: 'not-found' }, 404);
  });
}

async function mount(path = '/inbox') {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root?.render(
      <MemoryRouter initialEntries={[path]}>
        <InboxPage />
      </MemoryRouter>,
    ),
  );
}

const rows = () => [...host.querySelectorAll<HTMLButtonElement>('.inbox-row')];
const textarea = () => {
  const el = host.querySelector('textarea');
  if (!el) throw new Error('no reply field');
  return el;
};
const type = (el: HTMLTextAreaElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

describe('host inbox', () => {
  it('opens the message an email link names, and ignores an unknown one', async () => {
    stubApi([URGENT, { ...READ, readAt: null }]);
    await mount('/inbox?message=h2');
    await vi.waitFor(() => expect(host.querySelector('.inbox-detail')).not.toBeNull());
    expect(rows()[1]?.getAttribute('aria-current')).toBe('true');
    expect(calls.filter((c) => c.url === '/api/host/inbox/h2/read')).toHaveLength(1);
    act(() => root?.unmount());

    stubApi([URGENT]);
    await mount('/inbox?message=nope');
    await vi.waitFor(() => expect(rows()).toHaveLength(1));
    expect(host.querySelector('.inbox-detail')).toBeNull();
    expect(calls.some((c) => c.url.endsWith('/read'))).toBe(false);
  });

  it('lists messages with urgency and state, the translation first', async () => {
    stubApi([URGENT, READ]);
    await mount();
    await vi.waitFor(() => expect(rows()).toHaveLength(2));
    const [first, second] = rows();
    expect(first?.textContent).toContain('No hot water in the shower.');
    expect(first?.textContent).toContain('Urgent');
    expect(first?.textContent).toContain('New');
    expect(first?.dataset.unread).toBe('true');
    expect(second?.textContent).toContain('Replied');
    expect(second?.dataset.unread).toBeUndefined();
  });

  it('opening a message marks it read once and shows the original on request', async () => {
    stubApi([URGENT]);
    await mount();
    await vi.waitFor(() => expect(rows()).toHaveLength(1));
    await act(async () => rows()[0]?.click());
    await act(async () => rows()[0]?.click());
    expect(calls.filter((c) => c.url === '/api/host/inbox/h1/read')).toHaveLength(1);
    const detail = host.querySelector('.inbox-detail');
    expect(detail?.textContent).toContain('No hot water in the shower.');
    expect(detail?.textContent).toContain('Translated from German');
    expect(rows()[0]?.textContent).toContain('Read');
    const toggle = [...(detail?.querySelectorAll('button') ?? [])].find(
      (b) => b.textContent === 'Show original',
    );
    await act(async () => toggle?.click());
    expect(detail?.textContent).toContain('Kein warmes Wasser in der Dusche.');
    expect(detail?.textContent).toContain('Original in German. Show translation');
    expect(detail?.textContent).not.toContain('Translated from');
  });

  it('refreshes on its own: new messages and a delivered reply appear without a reload', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const pending: HostMessage = {
        ...READ,
        reply: {
          text: 'Yes, in the bathroom drawer.',
          repliedAt: '2026-10-24T10:05:00.000Z',
          translationState: 'pending',
          deliveredAt: null,
        },
      };
      const served = [pending];
      stubApi(served);
      await mount();
      await vi.waitFor(() => expect(rows()).toHaveLength(1));
      await act(async () => rows()[0]?.click());
      expect(host.querySelector('.inbox-detail')?.textContent).toContain(
        'Translating for the guest…',
      );

      served.splice(0, 1, URGENT, READ);
      await act(async () => {
        vi.advanceTimersByTime(15_000);
      });
      await vi.waitFor(() => expect(rows()).toHaveLength(2));
      expect(host.querySelector('.inbox-detail')?.textContent).toContain('Delivered to the guest');
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends a reply and shows it with its delivery', async () => {
    const replied: HostMessage = {
      ...URGENT,
      readAt: '2026-10-25T09:00:00.000Z',
      reply: {
        text: 'A plumber comes at 16:00.',
        repliedAt: '2026-10-25T09:00:00.000Z',
        translationState: 'pending',
        deliveredAt: null,
      },
    };
    stubApi([URGENT], () => json({ message: replied }));
    await mount();
    await vi.waitFor(() => expect(rows()).toHaveLength(1));
    await act(async () => rows()[0]?.click());
    await type(textarea(), 'A plumber comes at 16:00.');
    await act(async () => {
      textarea().form?.requestSubmit();
    });
    await vi.waitFor(() =>
      expect(host.querySelector('.inbox-detail')?.textContent).toContain(
        'Translating for the guest…',
      ),
    );
    expect(calls.find((c) => c.url === '/api/host/inbox/h1/reply')?.body).toEqual({
      text: 'A plumber comes at 16:00.',
    });
    expect(host.querySelector('textarea')).toBeNull();
    expect(rows()[0]?.textContent).toContain('Replied');
  });

  it('says so when the message was already answered', async () => {
    stubApi([URGENT], () => json({ error: 'already-replied' }, 409));
    await mount();
    await vi.waitFor(() => expect(rows()).toHaveLength(1));
    await act(async () => rows()[0]?.click());
    await type(textarea(), 'Hello');
    await act(async () => {
      textarea().form?.requestSubmit();
    });
    await vi.waitFor(() =>
      expect(host.querySelector('[role="alert"]')?.textContent).toBe(
        'You already replied to this message.',
      ),
    );
  });

  it('shows a short empty state', async () => {
    stubApi([]);
    await mount();
    await vi.waitFor(() => expect(host.textContent).toContain('No guest messages yet'));
    expect(host.querySelector('.mascot, img')).toBeNull();
  });

  it('shows a waiting own-service Order with its answers, and posts Accept', async () => {
    orders = [ASKED];
    stubApi([]);
    action = () =>
      json({ outcome: 'applied', order: { ...ASKED, status: 'confirmed', actions: [] } });
    await mount();
    const card = () => host.querySelector('.order-card');
    await vi.waitFor(() => expect(card()).not.toBeNull());
    expect(host.textContent).toContain('Orders for your services');
    expect(card()?.textContent).toContain('Airport transfer');
    expect(card()?.textContent).toContain('Mon 26 Oct · 14:30 · 3 people · €135.00');
    expect(card()?.textContent).toContain('Ana Horvat · +385 91 000 0000');
    expect(card()?.textContent).toContain('Answer by Sun 25 Oct, 12:00');
    const buttons = [...(card()?.querySelectorAll('button') ?? [])].map((b) => b.textContent);
    expect(buttons).toEqual(['Accept', 'Suggest another time', 'Decline']);
    await act(async () =>
      [...(card()?.querySelectorAll('button') ?? [])]
        .find((b) => b.textContent === 'Accept')
        ?.click(),
    );
    await vi.waitFor(() =>
      expect(card()?.textContent).toContain('Accepted. The guest has been told.'),
    );
    expect(calls.find((c) => c.url === '/api/host/orders/o1/actions')?.body).toEqual({
      action: 'accept',
      proposalId: 'p1',
    });
  });

  it("shows the guest's note in the host's language with the original under it", async () => {
    orders = [
      {
        ...ASKED,
        guestNote: {
          text: 'Preuzimanje u marini, 4 velika kofera',
          translation: 'Pickup at the marina, 4 big suitcases',
          translatedTo: 'en',
        },
      },
      {
        ...ASKED,
        orderId: 'o2',
        proposalId: 'p2',
        guestNote: { text: 'Gate 2', translation: 'Vrata 2', translatedTo: 'hr' },
      },
    ];
    stubApi([]);
    await mount();
    await vi.waitFor(() => expect(host.querySelectorAll('.order-card-note')).toHaveLength(2));
    const [first, second] = [...host.querySelectorAll('.order-card-note')];
    expect(first?.textContent).toBe(
      'Guest note: Pickup at the marina, 4 big suitcasesOriginal: Preuzimanje u marini, 4 velika kofera',
    );
    expect(second?.textContent).toBe('Guest note: Gate 2');
  });

  it('says the Order changed when the answer is stale', async () => {
    orders = [ASKED];
    stubApi([]);
    action = () => json({ outcome: 'stale', order: ASKED });
    await mount();
    await vi.waitFor(() => expect(host.querySelector('.order-card')).not.toBeNull());
    await act(async () =>
      [...host.querySelectorAll('.order-card button')]
        .find((b) => b.textContent === 'Decline')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
    await vi.waitFor(() =>
      expect(host.querySelector('.order-card')?.textContent).toContain(
        'This order changed — refreshed.',
      ),
    );
  });

  it('counts waiting Orders in the nav badge with unread messages', async () => {
    orders = [ASKED];
    ordersWaiting = 2;
    stubApi([URGENT]);
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
      root?.render(
        <MemoryRouter initialEntries={['/inbox']}>
          <App />
        </MemoryRouter>,
      ),
    );
    await vi.waitFor(() => expect(host.querySelector('.nav-badge')?.textContent).toBe('3'));
    expect(host.querySelector('.nav-badge')?.getAttribute('aria-label')).toBe('3 waiting');
  });
});
