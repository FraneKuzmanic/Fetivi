// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { ChatView } from '../../chat/ChatTab';
import { SpaceProvider } from '../../space';
import { TripTab } from '../TripTab';

const item = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  kind: 'suggestion',
  date: '2026-10-23',
  time: null,
  title: 'Dinner in the old town',
  note: 'Book a table by the riva',
  placeId: null,
  offerId: null,
  orderId: null,
  orderStatus: null,
  ...over,
});

const planOf = (items: unknown[]) => ({
  plan: {
    checkIn: '2026-10-22',
    checkout: '2026-10-24',
    today: '2026-10-22',
    days: [
      { date: '2026-10-22', items: [] },
      { date: '2026-10-23', items },
      { date: '2026-10-24', items: [] },
    ],
  },
});

const FILLED = planOf([
  item({
    id: 'o1',
    kind: 'order',
    time: '09:00',
    title: 'Blue Lagoon boat trip',
    note: null,
    offerId: 'off1',
    orderId: 'o1',
    orderStatus: 'confirmed',
  }),
  item(),
]);

let root: Root | null = null;
let host: HTMLElement;
let calls: { url: string; method: string }[] = [];

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

/** Answers /api/plan with the replies in turn and /api/orders with none; records every call. */
function stubApi(...replies: (() => Response)[]) {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? 'GET' });
      if (url === '/api/plan') return (replies.shift() ?? replies.at(-1) ?? (() => json({})))();
      if (url === '/api/orders') return json({ orders: [] });
      return new Response(null, { status: 404 });
    }),
  );
}

/** Shows where the app went and with what state, so a test can check the state was cleared. */
function Where() {
  const location = useLocation();
  return (
    <output data-testid="where">{`${location.pathname} ${JSON.stringify(location.state)}`}</output>
  );
}

async function mount(closed = false) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root?.render(
      <MemoryRouter initialEntries={['/trip']}>
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
          <Routes>
            <Route path="/trip" element={<TripTab />} />
            <Route path="/chat" element={<ChatView initial={[]} />} />
          </Routes>
          <Where />
        </SpaceProvider>
      </MemoryRouter>,
    ),
  );
}

const askButtons = () =>
  [...host.querySelectorAll('button')].filter((b) => b.textContent === 'Ask Fetivi');

describe('My trip → Plan', () => {
  it('shows every day with suggestions and booked items, read-only but for Ask', async () => {
    stubApi(() => json(FILLED));
    await mount();
    await vi.waitFor(() => expect(host.querySelector('.fv-plan')).not.toBeNull());
    const headings = [...host.querySelectorAll('.fv-plan h3')].map((h) => h.textContent);
    expect(headings).toEqual([
      'Thursday, October 22Today',
      'Friday, October 23',
      'Saturday, October 24',
    ]);
    const booked = host.querySelector('[data-kind="order"]')?.textContent;
    expect(booked).toContain('Blue Lagoon boat trip');
    expect(booked).toContain('Booked');
    expect(booked).toContain('Confirmed');
    expect(host.textContent).toContain('Any time');
    expect(host.textContent).toContain('Nothing planned yet');
    expect(askButtons()).toHaveLength(2);
    expect(host.querySelectorAll('.fv-plan input, .fv-plan textarea')).toHaveLength(0);
    // With a plan, Fetivi says nothing; the empty bookings get only their quiet line.
    expect(host.querySelector('.mascot-says')).toBeNull();
    expect(host.querySelector('.trip-empty')?.textContent).toBe('Nothing booked yet');
  });

  it('has Fetivi speak once about plans, under a title only screen readers get, when nothing is planned or booked', async () => {
    stubApi(() => json(planOf([])));
    await mount();
    await vi.waitFor(() => expect(host.textContent).toContain("Tell me in Chat what you'd like"));
    expect(host.querySelector('.fv-plan')).toBeNull();
    expect(host.querySelectorAll('.mascot-says')).toHaveLength(1);
    expect([...host.querySelectorAll('.trip-empty')].map((p) => p.textContent)).toEqual([
      'Nothing planned yet',
      'Nothing booked yet',
    ]);
    expect(host.textContent).toContain('Your plans and bookings will show up here.');
    expect(host.querySelector('a[href="/chat"]')).toBeNull();
    expect(host.querySelector('h1')?.className).toBe('visually-hidden');
    expect(host.querySelector('h1')?.textContent).toBe('My trip');
  });

  it('offers a retry when offline', async () => {
    stubApi(
      () => {
        throw new TypeError('offline');
      },
      () => json(FILLED),
    );
    await mount();
    await vi.waitFor(() => expect(host.textContent).toContain('No connection.'));
    await act(async () => {
      [...host.querySelectorAll('button')].find((b) => b.textContent === 'Try again')?.click();
    });
    await vi.waitFor(() => expect(host.querySelector('.fv-plan')).not.toBeNull());
    expect(calls.filter((c) => c.url === '/api/plan')).toHaveLength(2);
  });

  it('Ask Fetivi opens Chat with the question in the composer, not sent', async () => {
    stubApi(() => json(FILLED));
    await mount();
    await vi.waitFor(() => expect(askButtons()).toHaveLength(2));
    const ask = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Ask Fetivi about Dinner in the old town"]',
    );
    await act(async () => ask?.click());
    const input = await vi.waitFor(() => {
      const found = host.querySelector<HTMLTextAreaElement>('#chat-input');
      if (!found) throw new Error('no composer');
      return found;
    });
    expect(input.value).toBe('Tell me more about "Dinner in the old town" on Friday, October 23.');
    expect(document.activeElement).toBe(input);
    // The state is cleared, so a reload or a step back does not put the question in again.
    await vi.waitFor(() =>
      expect(host.querySelector('[data-testid="where"]')?.textContent).toBe('/chat null'),
    );
    expect(calls.some((c) => c.url.startsWith('/api/chat') && c.method === 'POST')).toBe(false);
  });

  it('has no Ask button after checkout', async () => {
    stubApi(() => json(FILLED));
    await mount(true);
    await vi.waitFor(() => expect(host.querySelector('.fv-plan')).not.toBeNull());
    expect(askButtons()).toHaveLength(0);
  });
});
